const toast=message=>{const el=document.querySelector('#toast');el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,4000);};
document.querySelectorAll('[data-share]').forEach(button=>button.addEventListener('click',async()=>{
 const path=button.dataset.url||(location.pathname.startsWith('/coupon/')||location.pathname==='/claim/success'?'/claim':location.pathname);
 const data={title:'Raju Reyaz Unisex Salon',text:'A fresh look. A little luxury. Discover our salon offers in Nagaon.',url:new URL(path,location.origin).href};
 try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);toast('Offer link copied. Share it with a friend.');}}catch(e){if(e.name!=='AbortError')toast('Share this link: '+data.url);}
}));
const audio=document.querySelector('#music-audio'),toggle=document.querySelector('#music-toggle');
if(audio){toggle.addEventListener('click',async()=>{try{if(audio.paused){await audio.play();toggle.textContent='Pause';toggle.setAttribute('aria-label','Pause music');}else{audio.pause();toggle.textContent='Play';toggle.setAttribute('aria-label','Play music');}}catch{toast('The music could not be played. Please try again.');}});audio.addEventListener('ended',()=>{toggle.textContent='Play';toggle.setAttribute('aria-label','Play music');});}
const leadForm=document.querySelector('#lead-form');
leadForm?.addEventListener('submit',()=>{const button=leadForm.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Saving your details…';});
// The server has already saved the award. This animation only reveals it.
const resultPage=document.querySelector('[data-new-spin="yes"]');
if(resultPage && !matchMedia('(prefers-reduced-motion: reduce)').matches){
 const stage=document.querySelector('#spin-stage'),result=document.querySelector('#coupon-result'),number=document.querySelector('#spin-number');
 const key='salon-revealed-'+document.querySelector('.coupon-code').textContent.trim();let seen=false;
 try{seen=sessionStorage.getItem(key)==='yes';}catch{}
 if(!seen){
  stage.hidden=false;result.hidden=true;let ticks=0;
  const animation=setInterval(()=>{number.textContent=String(100+(ticks*13)%51);ticks++;},75);
  setTimeout(()=>{clearInterval(animation);number.textContent=resultPage.dataset.spinValue;stage.classList.add('settled');},1800);
  setTimeout(()=>{stage.hidden=true;result.hidden=false;try{sessionStorage.setItem(key,'yes');}catch{}const title=result.querySelector('h1');title.tabIndex=-1;title.focus({preventScroll:true});},2300);
 }
}
const upload=document.querySelector('#logo-upload');
upload?.addEventListener('submit',async event=>{
 event.preventDefault();const file=upload.elements.logo.files[0],status=document.querySelector('#logo-upload-status'),button=upload.querySelector('button');
 if(!file||file.size>5*1024*1024){status.textContent='Choose an image smaller than 5 MB.';return;}
 button.disabled=true;status.textContent='Uploading…';
 try{const response=await fetch('/admin/logo',{method:'POST',headers:{'Content-Type':file.type,'X-CSRF-Token':upload.elements.csrf.value},body:file});const data=await response.json();if(!response.ok)throw Error(data.error||'Upload failed.');location.reload();}catch(e){status.textContent=e.message;button.disabled=false;}
});
const pixel=document.body.dataset.pixel,banner=document.querySelector('#cookie-consent');
let loaded=false;
const readChoice=()=>{try{return localStorage.getItem('salon-marketing');}catch{return null;}};
const saveChoice=value=>{try{localStorage.setItem('salon-marketing',value);}catch{}};
function enablePixel(){
 if(loaded||!pixel||location.pathname.startsWith('/admin')||location.pathname.startsWith('/coupon/'))return;
 loaded=true;
 const fbq=window.fbq=function(){fbq.callMethod?fbq.callMethod.apply(fbq,arguments):fbq.queue.push(arguments);};fbq.queue=[];fbq.loaded=true;fbq.version='2.0';window._fbq=fbq;
 const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';document.head.append(script);
 // Disable automatic DOM events and automatic matching; never send form values.
 fbq('set','autoConfig',false,pixel);fbq('init',pixel);fbq('consent','grant');fbq('track','PageView');
 if(location.pathname==='/offers'||location.pathname==='/claim')fbq('track','ViewContent',{content_name:location.pathname==='/offers'?'Salon offers':'Welcome coupon'});
 if(document.querySelector('[data-lead-success="yes"]'))fbq('track','Lead',{content_name:'Welcome coupon'});
 document.querySelectorAll('[data-contact]').forEach(el=>el.addEventListener('click',()=>{if(readChoice()==='yes')fbq('track','Contact');}));
}
if(banner){banner.hidden=!!readChoice();if(readChoice()==='yes')enablePixel();document.querySelectorAll('[data-consent]').forEach(button=>button.addEventListener('click',()=>{const choice=button.dataset.consent;saveChoice(choice);banner.hidden=true;if(choice==='yes')enablePixel();else if(window.fbq)window.fbq('consent','revoke');}));document.querySelector('#privacy-choice')?.addEventListener('click',()=>banner.hidden=false);}
