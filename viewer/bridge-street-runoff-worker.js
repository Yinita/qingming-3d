import { createStreetRainField } from "./bridge-street-rain-field.js";

let field;
self.onmessage=({data})=>{
  if(data.type==="initialize") {
    field=createStreetRainField(data.layout);
    return;
  }
  const snapshot=field.advance(data.request,data.buffers);
  self.postMessage(snapshot,[snapshot.pixels,snapshot.grid]);
};
