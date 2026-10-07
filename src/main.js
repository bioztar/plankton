// Entry point. The page's own HTML is captured before rendering so
// Save and "Export read-only presenter copy" can re-emit this file with a plan embedded.
import { boot } from './ui/app.js';

const SOURCE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
boot(SOURCE);
