import{fileURLToPath}from'node:url';
import{defineConfig}from'vite';
export default defineConfig({root:fileURLToPath(new URL('../',import.meta.url)),publicDir:false,appType:'mpa',build:{outDir:'demo/public',emptyOutDir:false},preview:{host:'localhost',port:4200}});
