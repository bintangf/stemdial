import {chromium} from '/Users/bintang/.npm/_npx/9b9809298fe40d2c/node_modules/playwright-core/index.mjs';
const b=await chromium.launchPersistentContext('',{executablePath:process.env.CHROME,headless:false,args:['--enable-unsafe-webgpu']});
const p=await b.newPage(); p.on('console',m=>console.log(m.text()));
await p.goto('http://127.0.0.1:8125/tools/probe.html');
await p.waitForFunction(()=>document.body.innerText.includes('DONE'),null,{timeout:120000});
console.log(await p.textContent('#o')); await b.close();
