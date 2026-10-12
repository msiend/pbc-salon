const toast=message=>{const el=document.querySelector('#toast');el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,4000);};
document.querySelectorAll('[data-share]').forEach(button=>button.addEventListener('click',async()=>{
 const path=button.dataset.url||(location.pathname.startsWith('/coupon/')||location.pathname==='/claim/success'?'/claim':location.pathname);
 const data={title:'Raju Riyaz Unisex Salon',text:'A fresh look. A little luxury. Discover our salon offers in Nagaon.',url:new URL(path,location.origin).href};
 try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);toast('Offer link copied. Share it with a friend.');}}catch(e){if(e.name!=='AbortError')toast('Share this link: '+data.url);}
}));
const audio=document.querySelector('#music-audio'),toggle=document.querySelector('#music-toggle');
if(audio){toggle.addEventListener('click',async()=>{try{if(audio.paused){await audio.play();toggle.textContent='Pause';toggle.setAttribute('aria-label','Pause music');}else{audio.pause();toggle.textContent='Play';toggle.setAttribute('aria-label','Play music');}}catch{toast('The music could not be played. Please try again.');}});audio.addEventListener('ended',()=>{toggle.textContent='Play';toggle.setAttribute('aria-label','Play music');});}
const leadForm=document.querySelector('#lead-form');
leadForm?.addEventListener('submit',()=>{const button=leadForm.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Creating your coupon…';});
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
