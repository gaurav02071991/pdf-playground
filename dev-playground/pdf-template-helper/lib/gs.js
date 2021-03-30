const { dirname } = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const GS_COMMAND = 'gs';
const GS_COMMAND1 = 'gswin64c';
const gsExec = (args, options) => {
  const command = ([GS_COMMAND1].concat(args || [])).join(' ');

  return exec(command, options);
};

const merge = (inputPdfFilePaths, outputPdfFilePath) => {
  const tempDir = dirname(outputPdfFilePath);

  const switches = [
    // '-sFONTPATH=/path/to/fonts',
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    '-dPDFSETTINGS=/printer',
    '-dAutoRotatePages=/None',
    '-dDetectDuplicateImages',
    '-sDEVICE=pdfwrite',
    `-sOutputFile=${outputPdfFilePath}`
  ];

  const args = switches.concat(inputPdfFilePaths);
  return gsExec(args, { env: { TMPDIR: tempDir } });
};

module.exports = {
  merge
};
