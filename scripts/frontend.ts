import express from 'express';
import {resolve} from 'node:path';
// Demo hosting: browsers call the separately hosted API directly.
const app=express();app.disable('x-powered-by');
app.use('/api',(_req,res)=>res.status(404).json({error:{code:'API_HOSTED_SEPARATELY'}}));
app.use(express.static(resolve('dist'),{etag:false,maxAge:0}));
app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
app.listen(Number(process.env.PORT)||3000,'0.0.0.0');
