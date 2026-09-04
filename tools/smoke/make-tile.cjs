// Build a 256x256 PNG that looks like a map tile (so pixel checks are meaningful)
const zlib = require('zlib');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}
 let x=0xFFFFFFFF;for(const b of buf)x=t[(x^b)&0xFF]^(x>>>8);return (x^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
 const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));
 return Buffer.concat([len,td,crc]);}
const W=256,H=256;const raw=Buffer.alloc(H*(1+W*3));
for(let y=0;y<H;y++){const off=y*(1+W*3);raw[off]=0;
 for(let x=0;x<W;x++){const i=off+1+x*3;
  // pale map-ish ground with a grid, unmistakable in a pixel sample
  const grid=(x%64===0||y%64===0);
  raw[i]=grid?200:242; raw[i+1]=grid?205:239; raw[i+2]=grid?200:233;}}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
 chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
require('fs').writeFileSync(process.argv[2],png);
console.log('tile written',png.length,'bytes');
