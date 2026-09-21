import { copyFileSync } from 'node:fs';
copyFileSync('node_modules/exceljs/dist/exceljs.min.js', 'assets/vendor/exceljs.min.js');
copyFileSync('node_modules/exceljs/LICENSE', 'assets/vendor/EXCELJS-LICENSE.txt');
