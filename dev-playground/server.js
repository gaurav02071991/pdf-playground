var http = require('http');
var express = require('express');
var path = require('path');
var bodyParser = require('body-parser');
const { processForm, processMultiForm } = require('./pdf-template-helper/lib/processForm');
const fs = require('fs');
const pdftk = require('node-pdftk');
const _ = require('lodash');
const mkdirp = require('mkdirp');
var app = express();
const gs = require('./pdf-template-helper/lib/gs');
const pdf = require('pdf-parse');
require('dotenv').config()

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({
	limit: '20mb',
  parameterLimit: 100000,
  extended: true 
}));
app.use(bodyParser.urlencoded({
	extended: true,
    limit: '50mb'
}));

const runSingle = async (templatePath, request) => {
	const formTemplateDirectory = path.resolve(templatePath);
	const dataFileName = request;
	let file;

	try {
		file = await processForm(formTemplateDirectory, dataFileName, process.env.genschema || true);
	} catch (err) {
		console.error(`error filling form "${formTemplateDirectory}": ${err.message}`);
		throw new Error(err)
	}
	return file;
};
const multiformdata = (multipath, request) => {
	let files = []
	let promises = []
	multipath.forEach((templatePath) => {
		const formTemplateDirectory = path.resolve(templatePath.formpath);
		const blankpage = path.resolve(__dirname + '\\blank.pdf');
		const dataFileName = request;
		let promise = processMultiForm(formTemplateDirectory, dataFileName, process.env.genschema || false).then((file) => {
			//_.set(files, `file${counter}`, file.outputFile);
			files.push(file.outputFile);
			if (templatePath.addEvenPage) {
				files.push(blankpage);
			}
		});
		promises.push(promise);


	})
	return Promise.all(promises).then(() => {
		return { files };
	})

}
const runMultiple = async (multipath, request) => {
	try {
		let files = await multiformdata(multipath, request);
		if (files) {
			const outputDirectory = path.resolve('results', `TTIC_GA_HO3`);
			const outputFile1 = path.resolve(`${outputDirectory}\\newPDFs`, `packet.pdf`);
			const outputFile = path.resolve(`${outputDirectory}\\newPDFs`, `new_packet.pdf`);
			return await pdftk.input(files.files).cat().output(outputFile1).then(async (buffer) => {
				await gs.merge(outputFile1, outputFile)
				console.log(`Successfully filled to ${outputFile}`);

				return { outputFile, buffer }
			}).catch((err) => {
				throw new Error(err);
			})
		}

	}
	catch (err) {
		console.error(`error filling form : ${err.message}`);
		throw new Error(err)
	}




};
const pdfmetadata=(file)=>{
	let dataBuffer = fs.readFileSync(file);
	return pdf(dataBuffer).then(function(data) {
		console.log(data.metadata); 
		if(data.metadata._metadata){
			return data.metadata._metadata;
		}	
	}).catch((err)=>{
		throw err;
	});
}
const templateCreation = async (tempPath, request) => {
	const outputDirectory = path.resolve('results');
	mkdirp(outputDirectory);
	const inutputFile = path.resolve(outputDirectory, `${request}.pdf`);
	const outputFile = path.resolve(outputDirectory, `new_${request}.pdf`);
	return await pdftk
		.input(`${tempPath}\\${request}.pdf`)
		.fillForm()
		.flatten()
		.output(inutputFile).then(async (buffer) => {
			await gs.merge(inutputFile, outputFile)
			console.log(`Successfully filled to ${outputFile}`);
			return { outputFile, buffer, filepaths:{inutputFile,outputFile} }
		}).catch((err) => {
			return err
		});
};
app.post('/pdf', async function (req, res) {
	try {
		const multipath = [];
		let changedFormpaths = [{ "formNumber": "TTIC HO3 Renewal Letter", "editionDate": "08 18", "formpath": "TTICHO3Renewal0818" },
		{ "formNumber": "TTIC Privacy", "editionDate": "01 16", "formpath": "TTICPrivacyPolicy0116" }, { "formNumber": "TTIC QSHO3", "editionDate": "12 20", "formpath": "TTICCWQSHO31220" },
		{ "formNumber": "TTIC APP", "editionDate": "12 20", "formpath": "TTICCWHO3APP1220" }, { "formNumber": "TTIC CW HO3J", "editionDate": "12 20", "formpath": "TTICCWHOJ1220" },
		{ "formNumber": "TTIC GA HO 5001", "editionDate": "12 20", "formpath": "TTICGA50011220" }]
		eval(req.body.content);
		let tempPath = '';
		if (process.env.createTemplate === 'true') {
			tempPath = path.resolve(`createTemplate`);
		}
		else {
			tempPath = path.resolve(`${company}/company-packages/${companyPackage.toLowerCase()}/data/formtemplates/${formrequest.formInfo.forms[0].formNumber.replace(/ /g, '').replace(/\//g, '')}${formrequest.formInfo.forms[0].editionDate.replace(/ /g, '')}`);


			if (formrequest.formInfo.forms.length > 1) {

				formrequest.formInfo.forms.forEach((form) => {
					let formdata = {};
					let formpath = '';
					let checkpath = _.filter(changedFormpaths, (formdata) => {
						return (formdata.formNumber === form.formNumber && formdata.editionDate === form.editionDate)
					})
					if (checkpath.length > 0) {
						formpath = `${company}/company-packages/${companyPackage.toLowerCase()}/data/formtemplates/${checkpath[0].formpath}`;
						formdata = { formpath, addEvenPage: form.addEvenPage }
					}
					else {

						formpath = `${company}/company-packages/${companyPackage.toLowerCase()}/data/formtemplates/${form.formNumber.replace(/ /g, '').replace(/\//g, '')}${form.editionDate.replace(/ /g, '')}`;
						formdata = { formpath, addEvenPage: form.addEvenPage }
					}
					multipath.push(formdata);
				})
			}
		}
		const file = (process.env.createTemplate === 'true') ? await templateCreation(tempPath, templateName) :
			multipath.length > 1 ? await runMultiple(multipath, formrequest) : await runSingle(tempPath, formrequest);
		if (fs.existsSync(file.outputFile)) {
			const metadata=await pdfmetadata(file.outputFile);
			fs.readFile(path.resolve(file.outputFile), 'base64', function (err, data) {
				if (err) {
					return console.log(err);
				}
				var newdata = ('data:application/pdf;base64,' + data);
				res.contentType('application/pdf');
				if(process.env.deletefiles==='1' && file.filepaths){
					fs.unlink(file.filepaths.inutputFile, (err) => {
						if (err) throw err;
						console.log('file was deleted');
					  });
					  fs.unlink(file.filepaths.outputFile, (err) => {
						if (err) throw err;
						console.log('file was deleted');
					  });  
				}
				res.send({newdata,metadata});
			});
		}
		else {
			var buff = Buffer.from(file.buffer, 'binary').toString('base64');
			var newdata = ('data:application/pdf;base64,' + buff);
			res.contentType('application/pdf');
			res.send(newdata);
		}



	} catch (err) {
		res.send(err.stack)
	}
});
app.post('/generatetemplate', function (req, res) {
	const outputDirectory = path.resolve('results');
	mkdirp(outputDirectory);
	const inutputFile = path.resolve(outputDirectory, `temp.pdf`);
	const outputFile = path.resolve(outputDirectory, `new_temp.pdf`);
        const data= req.body;
		const binarydata=new Buffer(data.resume, 'base64');
		pdftk
		.input(binarydata)
		.output(inutputFile).then(async (buffer) => {
			await gs.merge(inutputFile, outputFile)
			if (fs.existsSync(outputFile)) {
				const metadata=await pdfmetadata(outputFile);
				fs.readFile(path.resolve(outputFile), 'base64', function (err, data) {
					if (err) {
						return console.log(err);
					}
					var newdata = ('data:application/pdf;base64,' + data);
					res.contentType('application/pdf');
					if(process.env.deletefiles==='1' && outputFile && inutputFile){
						fs.unlink(inutputFile, (err) => {
							if (err) throw err;
							console.log('file was deleted');
						  });
						  fs.unlink(outputFile, (err) => {
							if (err) throw err;
							console.log('file was deleted');
						  });  
					}
					res.send({newdata,metadata});
				});
			}
			else {
				var buff = Buffer.from(file.buffer, 'binary').toString('base64');
				var newdata = ('data:application/pdf;base64,' + buff);
				res.contentType('application/pdf');
				res.send(newdata);
			}
		}).catch((err) => {
			console.log(err)
			res.send(err);
		});
		
})

var server = http.createServer(app);
var port = process.env.PORT || 12345;
server.listen(port);

console.log('http server listening on port %d', port);
console.log('dev-playground is available at http://localhost:%d', port);
