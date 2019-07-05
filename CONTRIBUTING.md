## Contributing

Contributions by anyone are welcome.
You can help by expanding the code, implementing more test cases, or just using the compiler and reporting bugs.

### editorconfig

To ensure consistent indentation and encoding, we use the editorconfig framework. It's settings are stored in the `.editorconfig` file.
Many applications support it natively. Please refer to the [documentation](https://editorconfig.org/#download) on how to enable or install it.

### API Documentation

The internal compiler API documentation is built using [TypeDoc](https://typedoc.org/).
To build it, run `npm run build:doc` in a terminal.  
It will be hosted on the official documentation page.


### Testing

#### High-level

To test the whole compiler, we have a simple script that tries to compile some test files and run the resulting binaries.
It only depends on `/bin/bash` and `date` so it should run on most systems.
It naively checks the exit codes of the compiler and the binaries and outputs files for which it was not `0`.  
To check for possible memory leaks we use [valgrind](http://valgrind.org/).
The script works without it but will complain about the missing dependency.  
You can invoke it with `run_tests.sh`.

#### Unit tests

We are currently in the process of integrating unit tests into the compiler.
For this, [chai](https://www.chaijs.com/) and [mocha](https://mochajs.org/) (+ [mocha-typescript](https://github.com/pana-cc/mocha-typescript)) are used.
The tests can be run with `npm run test` or `npm run test:watch`.

Additionally, [istanbul](https://istanbul.js.org/) is used to provide test coverage reports.
It can be invoked with `npm run test:coverage`.

To use the unit tests in editors like VS Code, the easiest way is to just run the `npm: test:watch` task and leave the corresponding terminal open.
It will refresh on every file save and output the tests that failed.

Please not that all imports in tests have to be done through the _index.ts_ files (only specify the folder) wherever they are present.
Failure to do so will result in errors at runtime.
