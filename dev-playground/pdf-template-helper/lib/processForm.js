'use strict';

const stringFormatters = require('exframe-string-formatters');
const { generateValidator } = require('exframe-request-validator');
const path = require('path');
const { compile } = require('json-transpose');
const pdftk = require('node-pdftk');
const yaml = require('yaml');
const fs = require('fs');
const shortid = require('shortid');
const mkdirp = require('mkdirp');
const _ = require('lodash');
const gs = require('./gs')
const toJsonSchema = require('to-json-schema');
const PDFParser = require('pdf2json');

const extractFormFields = (formFile, outputFile) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    const fieldSet = new Set();
    pdfParser.on('pdfParser_dataError', errData => reject);
    pdfParser.on('pdfParser_dataReady', pdfData => {
      pdfData.formImage.Pages.forEach((page) => {
        page.Fields.forEach((field) => fieldSet.add(field.id.Id));
      });
      const fieldsYaml = [...fieldSet].reduce((acc, field) => `${acc}  ${field}: \n`, '');
      fs.writeFileSync(outputFile, `fieldMappings:\n${fieldsYaml}`);
      resolve();
    });
    pdfParser.loadPDF(formFile);
  });
};

function getFields(template) {
  const fields = {};

  let result;
  const matchFields = /(\b(it|_root)\b(\.([\w_\-$\[\]])+[(]?)+)/g; // eslint-disable-line no-useless-escape
  do {
    result = matchFields.exec(template);

    if (result) {
      const [field, , obj] = result;
      const parts = field.substring(obj.length + 1).split('.');

      if (parts.length > 0) {
        if (parts[parts.length - 1][parts[parts.length - 1].length - 1] === '(') {
          parts.pop();
        }
        const path = parts.join('.');
        fields[`${obj}.${path}`] = `${path}`;
      }
    }
  } while (result != null);

  return Object.keys(fields).map(key => [key, fields[key]]).sort((a, b) => a[0].length - b[0].length);
}

const processForm = async (formTemplateDirectory, dataFileName = '', generateSchema = true) => {
  console.log('generateSchema',generateSchema)
  console.log('formTemplateDirectory',formTemplateDirectory)
  const schemaFile = path.join(formTemplateDirectory, 'dataSchema.json');
  const fieldsFile = path.join(formTemplateDirectory, 'fields.yaml');
  const formFile = path.join(formTemplateDirectory, 'form.pdf');

  const template = yaml.parse(fs.readFileSync(fieldsFile, { encoding: 'utf8' }));
  const outputDirectory = path.resolve('results', `${template.companyCode}_${template.state}_${template.product}`);
  const formName = `${template.formNumber.replace(/\s/g, '').replace(/\//g, '')}_${template.editionDate.replace(/\s/g, '')}`;
console.log()
  mkdirp(outputDirectory);
  mkdirp(`${outputDirectory}\\requests`);
  mkdirp(`${outputDirectory}\\Schemas`);
  mkdirp(`${outputDirectory}\\fieldYmls`);
  mkdirp(`${outputDirectory}\\newPDFs`);
  mkdirp(`${outputDirectory}\\formdata`);

  console.group(`Processing form: ${formName}`);
  let data;
  if (dataFileName.data) {
    data = { ...dataFileName.data, ...dataFileName.formInfo };
  }
  else {
    data = { ...dataFileName, ...dataFileName.formInfo };
  }

  // Generate an empty field mapping as YAML map list. This will include names of all fields
  // defined in the PDF Acroform. It can be copy/pasted under the "fieldMappings" property
  // in the "fields.yaml" of a formtemplate.


  // Generate an initial schema. This is NOT a complete schema, just a starting point. It lacks:
  //   * The actual type of all value properties (defaults everything to string)
  //   * Any properties not used explicitly by the mappings (e.g. "formatAddress(it.agency.mailingAddress)")
  //   * The actual list of required properties (defaults everything to required)
  if (generateSchema) {
    const autoFieldMappingFileName = path.resolve(`${outputDirectory}\\fieldYmls`, `${formName}_autoFields.yaml`);
    await extractFormFields(formFile, autoFieldMappingFileName);
    console.log(`Wrote auto-generated field mapping to ${autoFieldMappingFileName}`);
    const usedData = {};
    const re = new RegExp(/it\.([^,)}\s]*)/, 'g');
    const searchString = JSON.stringify(template.fieldMappings);
    const clonedData = _.cloneDeep(data);
    await getFields(searchString).forEach((field) =>
      _.set(usedData, field[1], (field[1].indexOf('.amount') > -1 || field[1].indexOf('Amount') > -1) ? _.get(clonedData, field[1], 0) : _.get(clonedData, field[1], '')));

    const autoDataSchema = toJsonSchema(usedData, {
      postProcessFnc: (type, schema, value, defaultFnc) => {
        defaultFnc(type, schema, value);
        // if (type === 'string') {
        //   schema.minLength = 1;
        // }
        if (type === 'integer') {
          schema.type = "number";
        }
        if (type === 'null') {
          schema.type = ["string","number","null"];
        }
        if (type === 'object' && schema && schema.properties && schema.properties.zip) {
          schema.properties.zip.type = ["string", "integer"];
        }
        if (type === 'object' && schema && schema.properties && schema.properties.address2) {
          schema.properties.address2.type = ["string", "null"];
        }
        if (type === 'object' && schema && schema.properties && schema.properties.invoiceDueDate) {
          schema.properties.invoiceDueDate.type = ["string", "null"];
        }
        if (type === 'object' && schema && schema.properties && schema.properties==={}) {
          delete schema.properties
        }
        if (type === 'object' && schema && schema.required && schema.required===[]) {
          delete schema.required
        }
        if (type === 'object' && schema && schema.properties && schema.properties.summaryLedger) {
          schema.properties.summaryLedger.type = ["object", "null"];
          Object.keys(schema.properties.summaryLedger.properties).forEach((property) => {
            if (!["sumOfEndorsements","invoiceDueDate"].includes(property)) {
              delete schema.properties.summaryLedger.properties[property]
              _.pull(schema.properties.summaryLedger.required, property)
            }
          })
        }
        if (type === 'object' && schema && schema.properties && schema.properties.transactionDetails) {
          schema.properties.transactionDetails.type = ["array", "null"];
        }

        if (type === 'object' && schema && schema.properties) {
          Object.keys(schema.properties).forEach((key)=>{
            if(["careOf","_id","invoiceDate","__v","diffToBaseFloodElevation","secondaryPhoneNumber"].includes(key)){
              delete schema.properties[key]
            }
          })
          
        }
        // if (type === 'object' && schema && schema.properties && schema.properties.careOf) {
        //   delete schema.properties.careOf
        // }
        // if (type === 'object' && schema && schema.properties && schema.properties._id) {
        //   delete schema.properties._id
        // }

        // if (type === 'object' && schema && schema.properties && schema.properties.invoiceDate) {
        //   delete schema.properties.invoiceDate
        // }
        // if (type === 'object' && schema && schema.properties && schema.properties.__v) {
        //   delete schema.properties.__v
        // }
        // if (type === 'object' && schema && schema.properties && schema.properties.diffToBaseFloodElevation) {
        //   delete schema.properties.diffToBaseFloodElevation
        // }

        return schema;

      }, arrays: { mode: 'first' }, strings: { detectFormat: false }, objects: {
        postProcessFnc: (schema, obj, defaultFnc) => ({
          ...defaultFnc(schema, obj), required:
            Object.getOwnPropertyNames(obj).filter((property) => {
              return !['county','address2', "name2", "referenceNumber", "phoneNumber", "_id", "careOf", "zipExtension", "billToAdditionalInterest", "billToType", "emailAddress", "primaryPhoneNumber", "displayOnDec", "__v", "invoiceDueDate"
                , "diffToBaseFloodElevation", "invoiceDate","secondaryPhoneNumber","country","sumOfEndorsements","sinkhole"].includes(property)
            })

        })
      }
    });
    const newrequest = path.resolve(`${outputDirectory}\\requests`, `${formName}.json`);
    const autoSchemaFileName = path.resolve(`${outputDirectory}\\Schemas`, `${formName}_autoSchema.json`);
    const formdataFile=path.resolve(`${outputDirectory}\\formdata`, 
    `${template.formNumber.replace(/\s/g, '_').replace(/\//g, '')}-${template.editionDate.replace(/\s/g, '_')}-${template.companyCode}_${template.state}_${template.product}.yml`);
    usedData.formInfo = dataFileName.formInfo
    fs.writeFileSync(newrequest, JSON.stringify(usedData, undefined, 2));
    fs.writeFileSync(autoSchemaFileName, JSON.stringify(autoDataSchema, undefined, 2));
    fs.writeFileSync(formdataFile, '');
  }


  // Validate input date against the provided schema
  if (fs.existsSync(schemaFile)) {
    const dataSchema = require(schemaFile);
    const validateRequest = generateValidator(dataSchema);
    await validateRequest({}, data);
  }
  // Transpose field mapping

  const transform = compile(template.fieldMappings, {
    customObjects: { ...stringFormatters, shortid }
  });

  const fillData = transform(data);

  // Remove null field values, which indicates a field should use the default value

  Object.keys(fillData).forEach(key => fillData[key] === null && delete fillData[key]);
console.log('fillData',fillData)
  if (!_.isEmpty(fillData)) {
    const inutputFile = path.resolve(`${outputDirectory}\\newPDFs`, `${formName}.pdf`);
    const outputFile = path.resolve(`${outputDirectory}\\newPDFs`, `new_${formName}.pdf`);
    return await pdftk
      .input(formFile)
      .fillForm(fillData)
      .flatten()
      .output(inutputFile).then(async (buffer) => {
        await gs.merge(inutputFile, outputFile)
        console.log(`Successfully filled ${formFile} to ${outputFile}`);
        return { outputFile, buffer,filepaths:{inutputFile,outputFile} }
      }).catch((err) => {
        return err
      });
  }else{
    console.log('static form')
    const inutputFile = path.resolve(outputDirectory, `${formName}.pdf`);
    const outputFile = path.resolve(outputDirectory, `new_${formName}.pdf`);
    return await pdftk
      .input(formFile)
      .flatten()
      .output(inutputFile).then(async (buffer) => {
        await gs.merge(inutputFile, outputFile)
        console.log(`Successfully filled ${formFile} to ${outputFile}`);
        return { outputFile, buffer,filepaths:{inutputFile,outputFile} }
      }).catch((err) => {
        return err
      });
  }

  console.groupEnd();
};
const processMultiForm = async (formTemplateDirectory, dataFileName = '', generateSchema = true,formdata) => {
  const schemaFile = path.join(formTemplateDirectory, 'dataSchema.json');
  const fieldsFile = path.join(formTemplateDirectory, 'fields.yaml');
  const formFile = path.join(formTemplateDirectory, 'form.pdf');

  const template = yaml.parse(fs.readFileSync(fieldsFile, { encoding: 'utf8' }));
  const outputDirectory = path.resolve('results', `${template.companyCode}_${template.state}_${template.product}`);
  const formName = `${template.formNumber.replace(/\s/g, '').replace(/\//g, '')}_${template.editionDate.replace(/\s/g, '')}`;

  mkdirp(outputDirectory);
  mkdirp(`${outputDirectory}\\requests`);
  mkdirp(`${outputDirectory}\\Schemas`);
  mkdirp(`${outputDirectory}\\fieldYmls`);
  mkdirp(`${outputDirectory}\\newPDFs`);
 
  console.group(`Processing form: ${formName}`);
  let data;
  if (dataFileName.data) {
    data = { ...dataFileName.data, ...dataFileName.formInfo };
  }
  else {
    data = { ...dataFileName, ...dataFileName.formInfo };
  }
  if (generateSchema) {
    const usedData = {};
    const re = new RegExp(/it\.([^,)}\s]*)/, 'g');
    const searchString = JSON.stringify(template.fieldMappings);
    const clonedData = _.cloneDeep(data);
    await getFields(searchString).forEach((field) =>
      _.set(usedData, field[1], (field[1].indexOf('.amount') > -1 || field[1].indexOf('Amount') > -1) ? _.get(clonedData, field[1], 0) : _.get(clonedData, field[1], '')));

    const newrequest = path.resolve(`${outputDirectory}\\requests`, `packet_${formName}.json`);
    let forminfo=_.filter(dataFileName.formInfo.forms,(form)=>{
           return (form.formNumber===template.formNumber && form.editionDate===template.editionDate)
    })
    _.set(usedData,'formInfo.forms',forminfo);
    //usedData.formInfo['forms'] = forminfo;
    if(template.formNumber.indexOf('DEC')!==-1){
      delete usedData.formInfo.displayOnDec
    }
    fs.writeFileSync(newrequest, JSON.stringify(usedData, undefined, 2));
  }
  // Validate input date against the provided schema
  if (fs.existsSync(schemaFile)) {
    const dataSchema = require(schemaFile);
    const validateRequest = generateValidator(dataSchema);
    await validateRequest({}, data);
  }
  // Transpose field mapping

  const transform = compile(template.fieldMappings, {
    customObjects: { ...stringFormatters, shortid }
  });

  const fillData = transform(data);

  // Remove null field values, which indicates a field should use the default value

  Object.keys(fillData).forEach(key => fillData[key] === null && delete fillData[key]);
  if (!_.isEmpty(fillData)) {
    const inutputFile = path.resolve(`${outputDirectory}\\newPDFs`, `${formName}.pdf`);
    const outputFile = path.resolve(`${outputDirectory}\\newPDFs`, `new_${formName}.pdf`);
    return await pdftk
      .input(formFile)
      .fillForm(fillData)
      .flatten()
      .output(inutputFile).then(async (buffer) => {
        await gs.merge(inutputFile, outputFile)
        return { outputFile, buffer }
      }).catch((err) => {
        return err
      });
  }else{
    const inutputFile = path.resolve(outputDirectory, `${formName}.pdf`);
    const outputFile = path.resolve(outputDirectory, `new_${formName}.pdf`);
    return await pdftk
      .input(formFile)
      .flatten()
      .output(inutputFile).then(async (buffer) => {
        await gs.merge(inutputFile, outputFile)
        return { outputFile, buffer }
      }).catch((err) => {
        return err
      });
  }

  console.groupEnd();
};

module.exports = {processForm,processMultiForm};
