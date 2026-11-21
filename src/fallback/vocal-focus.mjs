// Compare mid/side energy in separate bands so a wide guitar doesn't duck a centered voice in another band.
export class VocalFocus {
  constructor(rate) {
    this.poles = [150,450,1500,4500,8500].map(hz => 1-Math.exp(-2*Math.PI*hz/rate));
    this.lowM = new Float64Array(5); this.lowS = new Float64Array(5);
    this.midPower = new Float64Array(6); this.sidePower = new Float64Array(6);
    this.cross = new Float64Array(6);
    this.weights = [.12,1,1,1,1,.25];
    this.smooth = 1-Math.exp(-1/(.022*rate));
  }
  sample(mid,side) {
    let lastM=0,lastS=0,sum=0;
    for(let k=0;k<6;k++) {
      const m=k===5?mid:(this.lowM[k]+=this.poles[k]*(mid-this.lowM[k]));
      const s=k===5?side:(this.lowS[k]+=this.poles[k]*(side-this.lowS[k]));
      const band=m-lastM, width=s-lastS;
      lastM=m;lastS=s;
      const p=this.midPower[k]+=this.smooth*(band*band-this.midPower[k]);
      const q=this.sidePower[k]+=this.smooth*(width*width-this.sidePower[k]);
      const cross=this.cross[k]+=this.smooth*(band*width-this.cross[k]);
      const coherence=cross*cross/(p*q+1e-18);
      sum+=band*this.weights[k]/(1+12*coherence*q/(p+q+1e-14));
    }
    return sum;
  }
}
