import {analyzeRecording} from './latency-analysis.mjs';
self.onmessage=({data})=>{try{self.postMessage({result:analyzeRecording(data)});}catch(error){self.postMessage({error:error.message});}};
