import {refineSurfaceCrossing} from './surface-search.js';

// A small writer for the same node operations the Three.js adapter supplies.
// The build emits shader text; the viewer does not ship this writer.
function writer(language){
  const scalar=language==='wgsl'?'f32':'float';
  let sequence=0,code='';
  const emit=line=>{code+=line+'\n';};
  const value=x=>x instanceof Expression?x:new Expression(typeof x==='boolean'?'bool':scalar,typeof x==='boolean'?String(x):Number.isInteger(x)?x+'.':String(x));
  class Expression{
    constructor(type,source){this.type=type;this.source=source;}
    toString(){return this.source;}
    binary(op,other,type=this.type){return new Expression(type,`(${this}${op}${value(other)})`);}
    add(x){return this.binary('+',x);}sub(x){return this.binary('-',x);}mul(x){return this.binary('*',x);}div(x){return this.binary('/',x);}
    dot(x){return new Expression(scalar,`dot(${this},${x})`);}length(){return new Expression(scalar,`length(${this})`);}
    max(x){return new Expression(this.type,`max(${this},${value(x)})`);}
    clamp(a,b){return new Expression(this.type,`clamp(${this},${value(a)},${value(b)})`);}
    abs(){return new Expression(this.type,`abs(${this})`);}
    negate(){return new Expression(this.type,`(-${this})`);}not(){return new Expression('bool',`(!${this})`);}
    greaterThan(x){return this.binary('>',x,'bool');}
    lessThan(x){return this.binary('<',x,'bool');}greaterThanEqual(x){return this.binary('>=',x,'bool');}
    notEqual(x){return this.binary('!=',x,'bool');}and(x){return this.binary('&&',x,'bool');}
    toVar(){const v=new Expression(this.type,'surface'+sequence++);emit(`${language==='wgsl'?'var':this.type} ${v}=${this};`);return v;}
    assign(x){emit(`${this}=${value(x)};`);}addAssign(x){emit(`${this}+=${value(x)};`);}
  }
  const If=(condition,body)=>{emit(`if(${condition}){`);body();emit('}');return{Else(other){emit('else{');other();emit('}');}};};
  const node=(type,source)=>new Expression(type,source);
  const Loop=(count,body)=>{if(count===0)return;const name='surfaceLoop'+sequence++;emit(`for(${language==='wgsl'?'var':'int'} ${name}=0;${name}<${count};${name}++){`);body();emit('}');};
  return{node,emit,result:()=>code,ops:{float:value,bool:value,vec2:(a,b)=>node(language==='wgsl'?'vec2f':'vec2',`${language==='wgsl'?'vec2f':'vec2'}(${a},${b})`),If,Loop}};
}

export function surfaceCrossingWgsl(){
  const crossing=(name,steps,secant)=>{
    const {node,emit,result,ops}=writer('wgsl');
    const hit=refineSurfaceCrossing(ops,{lo:node('f32','start'),hi:node('f32','end'),loValue:node('f32','value'),hiValue:node('f32','endValue'),height:at=>node('f32',`fieldAt(${at})`),steps,secant});
    emit(`return ${hit};`);
    return `fn ${name}(start:f32,end:f32,value:f32,endValue:f32)->f32{\n${result()}}`;
  };
  return crossing('interpolateCrossing',0,true)+crossing('refineCrossing',5,false);
}

export function surfaceCrossingGlsl(){
  const {node,emit,result,ops}=writer('glsl');
  const loop=ops.Loop;ops.Loop=(count,body)=>ops.If(node('bool','index>0'),()=>loop(count,body));
  const hit=refineSurfaceCrossing(ops,{lo:node('float','previous'),hi:node('float','t'),loValue:node('float','prev'),height:at=>node('float',`fieldAt(${at})`),steps:5,secant:false});
  emit(`float candidate=${hit};`);
  return result();
}
