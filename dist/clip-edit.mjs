// Worklet clocks can have a different initial origin after an iOS session reset.
// Such an origin must never move a take seconds away from the tap position.
export function takeOrigin(timelineStart,contextStart,sampleStart,latency=0){
 const delta=sampleStart-contextStart;
 const startup=Number.isFinite(delta)&&delta>=-.05&&delta<=.25?delta:0;
 const compensation=Number.isFinite(latency)&&latency>=0&&latency<=.5?latency:0;
 return timelineStart+startup-compensation;
}
export function movedStart(original,deltaPixels,pps,correction=0,max=600){
 const effective=original+correction/1000;
 return Math.max(0,Math.min(max,effective+deltaPixels/pps))-correction/1000;
}
export function attachClipDrag(el,{canEdit,position,commit,preview,scale,scroll,restore}){
 let gesture,timer,animation,suppressClick=false;
 const clear=()=>{clearTimeout(timer);cancelAnimationFrame(animation);el.classList.remove('dragging');};
 const apply=()=>{if(!gesture?.active)return;const delta=gesture.x-gesture.beginX+scroll().scrollLeft-gesture.scroll;gesture.value=movedStart(gesture.start,delta,scale(),position().correction,Math.max(0,600-(position().buffer?.duration||position().duration||0)));preview(gesture.value);};
 const pan=()=>{if(!gesture?.active)return;const sc=scroll(),r=sc.getBoundingClientRect(),edge=38;
  const velocity=gesture.x>r.right-edge?Math.min(9,(gesture.x-r.right+edge)/4):gesture.x<r.left+edge?-Math.min(9,(r.left+edge-gesture.x)/4):0;
  if(velocity){sc.scrollLeft+=velocity;apply();}animation=requestAnimationFrame(pan);
 };
 el.addEventListener('booth:gesturecancel',()=>{clear();if(gesture?.active)restore();gesture=undefined;el.removeAttribute('aria-grabbed');suppressClick=true;setTimeout(()=>suppressClick=false,400);});
 el.addEventListener('pointerdown',e=>{if(!canEdit()||e.button!==0||gesture)return;const p=position();gesture={id:e.pointerId,beginX:e.clientX,x:e.clientX,beginY:e.clientY,start:p.start,value:p.start,scroll:scroll().scrollLeft,scrollY:scroll().scrollTop,active:false};
  timer=setTimeout(()=>{if(!gesture||!el.isConnected||!canEdit()){gesture=undefined;return;}try{el.setPointerCapture(gesture.id);}catch{gesture=undefined;return;}gesture.active=true;suppressClick=true;el.classList.add('dragging');el.setAttribute('aria-grabbed','true');animation=requestAnimationFrame(pan);},350);
 });
 el.addEventListener('pointermove',e=>{if(!gesture||e.pointerId!==gesture.id)return;gesture.x=e.clientX;if(!gesture.active){if(Math.hypot(e.clientX-gesture.beginX,e.clientY-gesture.beginY)>8){clearTimeout(timer);gesture.scrolling=true;suppressClick=true;scroll().scrollLeft=gesture.scroll-(e.clientX-gesture.beginX);scroll().scrollTop=gesture.scrollY-(e.clientY-gesture.beginY);e.preventDefault();}return;}e.preventDefault();apply();});
 const finish=(e,cancel)=>{if(!gesture||e.pointerId!==gesture.id)return;const g=gesture;clear();gesture=undefined;el.removeAttribute('aria-grabbed');if(g.active){if(cancel)restore();else requestAnimationFrame(()=>commit(g.value));}if(g.active||g.scrolling)setTimeout(()=>suppressClick=false,400);};
 el.addEventListener('pointerup',e=>finish(e,false));el.addEventListener('pointercancel',e=>finish(e,true));el.addEventListener('lostpointercapture',e=>finish(e,true));
 el.addEventListener('click',e=>{if(suppressClick){e.stopImmediatePropagation();e.preventDefault();suppressClick=false;}},true);
 el.addEventListener('contextmenu',e=>e.preventDefault());
 el.addEventListener('keydown',e=>{if(!canEdit()||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const p=position();commit(movedStart(p.start,(e.key==='ArrowLeft'?-1:1)*(e.shiftKey ? .1 : .01)*scale(),scale(),p.correction,Math.max(0,600-(p.buffer?.duration||p.duration||0))));});
}
