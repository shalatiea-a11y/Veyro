const {chromium}=require(process.env.PW);
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage({viewport:{width:794,height:1123}});
await p.emulateMedia({media:'print'});
await p.goto('file:///home/user/Veyro/engelska-hafte/build/book.html');
const h=await p.evaluate(()=>document.body.scrollHeight);console.log(h);
for(const [i,y] of [[0,0],[1,3300],[2,6200],[3,9800],[4,14000]]){await p.screenshot({path:`/tmp/claude-0/shots/s${i}.png`,clip:{x:0,y,width:794,height:1123},fullPage:true});}
await b.close()})();
