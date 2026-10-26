export const clampZoom=value=>Math.max(8,Math.min(100,value));
export function attachPinchZoom(element,{canZoom,getScale,setScale}){
 let pinch,frame,pending,suppressUntil=0;
 const distance=touches=>Math.hypot(touches[1].clientX-touches[0].clientX,touches[1].clientY-touches[0].clientY);
 const flush=()=>{cancelAnimationFrame(frame);frame=undefined;if(pending!==undefined){setScale(pending,false);pending=undefined;}};
 const finish=()=>{if(!pinch)return;flush();pinch=undefined;suppressUntil=performance.now()+400;element.classList.remove('is-pinching');setScale(getScale(),true);};
 element.addEventListener('touchstart',event=>{
  if(event.touches.length<2)return;event.preventDefault();
  element.querySelectorAll('.clip').forEach(clip=>clip.dispatchEvent(new Event('booth:gesturecancel')));
  if(!canZoom())return;
  pinch={distance:Math.max(1,distance(event.touches)),scale:getScale()};element.classList.add('is-pinching');
 },{passive:false,capture:true});
 element.addEventListener('touchmove',event=>{
  if(!pinch||event.touches.length<2)return;event.preventDefault();event.stopPropagation();
  if(!canZoom()){finish();return;}
  pending=clampZoom(pinch.scale*distance(event.touches)/pinch.distance);
  if(!frame)frame=requestAnimationFrame(flush);
 },{passive:false,capture:true});
 element.addEventListener('touchend',event=>{if(pinch){event.preventDefault();if(event.touches.length<2)finish();}},{passive:false,capture:true});
 element.addEventListener('touchcancel',finish,{passive:true});
 element.addEventListener('click',event=>{if(pinch||performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
}
