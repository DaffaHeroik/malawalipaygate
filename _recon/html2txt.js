// HTML -> text extractor sederhana (tanpa dependency)
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
let h = fs.readFileSync(file, 'utf8');
h = h.replace(/<script[\s\S]*?<\/script>/gi, '')
     .replace(/<style[\s\S]*?<\/style>/gi, '')
     .replace(/<svg[\s\S]*?<\/svg>/gi, '')
     .replace(/<head[\s\S]*?<\/head>/gi, '')
     .replace(/<br\s*\/?>/gi, '\n')
     .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|tr|section|article|pre|label|dt|dd)>/gi, '\n')
     .replace(/<td[^>]*>/gi, ' | ')
     .replace(/<th[^>]*>/gi, ' | ')
     .replace(/<[^>]+>/g, '');
h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
     .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
     .replace(/&middot;/g, '-').replace(/&raquo;/g, '>').replace(/&laquo;/g, '<');
h = h.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
h = h.replace(/\n{3,}/g, '\n\n');
console.log(h);
