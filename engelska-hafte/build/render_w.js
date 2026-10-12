const {chromium}=require(process.env.PW);
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
await p.goto('file:///home/user/Veyro/engelska-hafte/build/book_w.html');
await p.pdf({path:'/home/user/Veyro/engelska-hafte/English-Grammar-Workbook-writing.pdf',format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;font-size:8px;color:#6c757d;text-align:center;font-family:sans-serif">The Complete English Grammar Workbook · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',margin:{top:'15mm',bottom:'17mm',left:'15mm',right:'15mm'},preferCSSPageSize:false});
await b.close()})();
