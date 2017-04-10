Generate parser:
./node_modules/.bin/pegjs -o lib/parser.js src/parser.pegjs 

Compile
node lib/index.js compile examples/example2.wl