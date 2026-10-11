/* Read GPS before image resizing strips metadata. No network requests. */
(function (root) {
  'use strict';
  function readGps(arrayBuffer) {
    try {
      const view=new DataView(arrayBuffer);const length=view.byteLength;
      const ascii=(start,count)=>{if(start<0||start+count>length)throw Error('bounds');let text='';for(let i=0;i<count;i++)text+=String.fromCharCode(view.getUint8(start+i));return text;};
      let start=-1,end=length;
      if(length>=4&&view.getUint16(0)===0xffd8){let offset=2;while(offset+4<=length){if(view.getUint8(offset)!==0xff)break;const marker=view.getUint8(offset+1);if(marker===0xda||marker===0xd9)break;const size=view.getUint16(offset+2);if(size<2||offset+2+size>length)break;if(marker===0xe1&&ascii(offset+4,6)==='Exif\0\0'){start=offset+10;end=offset+2+size;break;}offset+=2+size;}}
      else if(length>=8&&view.getUint32(0)===0x89504e47){let offset=8;while(offset+12<=length){const size=view.getUint32(offset);if(offset+12+size>length)break;if(ascii(offset+4,4)==='eXIf'){start=offset+8;end=start+size;break;}offset+=12+size;}}
      else if(length>=12&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){let offset=12;while(offset+8<=length){const size=view.getUint32(offset+4,true);if(offset+8+size>length)break;if(ascii(offset,4)==='EXIF'){start=offset+8;end=start+size;if(size>=6&&ascii(start,6)==='Exif\0\0')start+=6;break;}offset+=8+size+(size%2);}}
      if(start<0||start+8>end)return null;
      const order=ascii(start,2);if(order!=='II'&&order!=='MM')return null;const little=order==='II';
      const range=(offset,count)=>{if(offset<start||offset+count>end)throw Error('bounds');};
      const u16=offset=>{range(offset,2);return view.getUint16(offset,little);};
      const u32=offset=>{range(offset,4);return view.getUint32(offset,little);};
      if(u16(start+2)!==42)return null;
      const ifd=offset=>{const count=u16(offset);if(count>512)throw Error('count');range(offset+2,count*12);const tags=new Map();for(let i=0;i<count;i++){const pos=offset+2+i*12;const type=u16(pos+2),n=u32(pos+4),unit=({1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8})[type];if(!unit||n>100000)continue;const size=n*unit;const pointer=size<=4?pos+8:start+u32(pos+8);range(pointer,size);tags.set(u16(pos),{type,n,pointer});}return tags;};
      const main=ifd(start+u32(start+4));const gpsEntry=main.get(0x8825);if(!gpsEntry)return null;
      const gps=ifd(start+u32(gpsEntry.pointer));
      const ref=tag=>{const entry=gps.get(tag);return entry?ascii(entry.pointer,entry.n).replace(/\0/g,'').toUpperCase():'';};
      const rational=(entry,index)=>{if(!entry||entry.type!==5||index>=entry.n)throw Error('rational');const pos=entry.pointer+index*8,denominator=u32(pos+4);if(!denominator)throw Error('zero');return u32(pos)/denominator;};
      const dms=tag=>{const entry=gps.get(tag);if(!entry||entry.n!==3)return null;const degrees=rational(entry,0),minutes=rational(entry,1),seconds=rational(entry,2);if(minutes>60||seconds>60)return null;return degrees+minutes/60+seconds/3600;};
      const latRef=ref(1),lonRef=ref(3);const lat=dms(2),lon=dms(4);if(lat===null||lon===null||!['N','S'].includes(latRef)||!['E','W'].includes(lonRef))return null;
      const latitude=lat*(latRef==='S'?-1:1),longitude=lon*(lonRef==='W'?-1:1);if(Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
      return {latitude,longitude,source:'photo',accuracy:null};
    }catch{return null;}
  }
  root.TimeLensExif={readGps};
  if(typeof module!=='undefined'&&module.exports)module.exports={readGps};
})(typeof window==='undefined'?globalThis:window);
