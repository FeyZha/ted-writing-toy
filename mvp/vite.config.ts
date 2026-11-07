import {defineConfig} from 'vite';
export default defineConfig({server:{watch:{ignored:['**/data/**','**/.runtime/**','**/verification/**']},proxy:{
  '/api':{target:process.env.ENGLISH_WRITING_BACKEND??'http://127.0.0.1:4397',changeOrigin:true},
  '/media':{target:process.env.ENGLISH_WRITING_BACKEND??'http://127.0.0.1:4397',changeOrigin:true},
}}});
