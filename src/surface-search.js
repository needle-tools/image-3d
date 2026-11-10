// @ts-nocheck
// Node operations are supplied by TSL or the standalone shader writer. Keep
// intersection policy here; texture layouts and renderer state belong outside.
export function refineSurfaceCrossing({float,If,Loop},{lo,hi,loValue,hiValue,height,steps,secant}) {
  const a=lo.toVar(),b=hi.toVar(),fa=loValue.toVar(),fb=secant?hiValue.toVar():null;
  Loop(steps,()=>{
    const mid=a.add(b).mul(.5).toVar(),d=height(mid).toVar();
    If(d.mul(fa).greaterThan(0),()=>{a.assign(mid);if(secant)fa.assign(d);}).Else(()=>{b.assign(mid);if(secant)fb.assign(d);});
  });
  return secant?a.add(b.sub(a).mul(fa.abs().div(fa.abs().add(fb.abs()).max(1e-20)).clamp(0,1))):a.add(b).mul(.5);
}
