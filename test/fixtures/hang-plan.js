'use strict';
// test-only preload (NODE_OPTIONS=--require): make the model planner hang forever (v1.3.5 planner timeout test).
const path = require('path');
require(path.join(__dirname, '..', '..', 'lib', 'models')).plan = () => new Promise(() => {});
