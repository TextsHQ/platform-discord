# transform-discord-emoji-mapping
Transforms Discord emoji mappings to `Map<string, string>`

### How to?
1. Open Discord `Sources` tab
2. Search for `face_in_clouds` (or any other known emoji name) in *assets* folder (query: `file:assets "face_in_clouds"`)
3. Open the file containing something like this:
```js
406788: e=>{
	"use strict";
	e.exports = JSON.parse('[{"emoji":"angry","shortcuts":[">:(",">:-(",">=(",">=-("]}, // ...
}
,
503033: e=>{
	"use strict";
	e.exports = JSON.parse('{"people":[{"names":["grinning"],"surrogates":"😀","unicodeVersion":6.1}, // ...
}
```
4. Eval both `JSON.parse` calls and save outcomes to `shortcuts-raw.json` and `emojis-raw.json`
5. Run `transform-discord-emoji-mapping.js` with both `.json` files in directory
6. Copy `emojis.json` and `shortcuts.json` to `src/resources/`
