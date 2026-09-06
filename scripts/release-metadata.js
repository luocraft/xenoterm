const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const version = require('../package.json').version;
const output = path.resolve(process.argv[2] || 'release');
const fileName = `XenoTerm-Setup-${version}.exe`;
const target = path.join(output, fileName);
const hash = crypto.createHash('sha256');
fs.createReadStream(target).on('data',chunk=>hash.update(chunk)).on('error',err=>{console.error(err.message);process.exitCode=1;}).on('end',()=>{
  const release = { version, fileName, size: fs.statSync(target).size, sha256: hash.digest('hex'), releasedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output,'release.json'),JSON.stringify(release,null,2)+'\n');
  console.log(`Release metadata written for ${fileName}`);
});
