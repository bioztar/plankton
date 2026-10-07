// DOMParser shim for tests: the same inert parser the app falls back to when
// DOMParser is missing (src/util/htmlparse.js).
import { parseHTML } from '../src/util/htmlparse.js';

export { parseHTML };

export class MiniDOMParser {
  parseFromString(html) {
    const m = /<body>([\s\S]*)<\/body><\/html>$/.exec(html);
    return parseHTML(m ? m[1] : html);
  }
}

if (!globalThis.DOMParser) globalThis.DOMParser = MiniDOMParser;
