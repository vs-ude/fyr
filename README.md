## Installation

See http://fyr.vs.uni-due.de for more information.

## Testing

### High-level

To test the whole compiler, we have a simple script that tries to compile some test files and run the resulting binaries.
It only depends on `/bin/bash` and `date` so it should run on most systems.
You can invoke it with `run_tests.sh`.
It naively checks the exit codes of the compiler and the binaries and outputs files for which it was not `0`.

### Unit tests

We are currently in the process of integrating unit tests into the compiler.
For this, [chai](https://www.chaijs.com/) and [mocha](https://mochajs.org/) are used.
The tests can be run with `npm run test:once` or `npm run test:watch`.

Additionally, [istanbul](https://istanbul.js.org/) is used to provide test coverage reports.
It can be invoked with `npm run test:coverage`.

To use the unit tests in editors like VS Code, the easiest way is to just start the `npm: build:test-watch` script, wait for it to build once, then run the `npm: test:watch` task and leave the corresponding terminal open.
It will refresh on every file save and output the tests that failed.
Newly created tests will not be picked up by `npm: test:watch` so a restart of the task is necessary.


## editorconfig

To ensure consistent indentation and encoding, we use the editorconfig framework. It's settings are stored in the `.editorconfig` file.
Many applications support it natively. Please refer to the [documentation](https://editorconfig.org/#download) on how to enable or install it.
