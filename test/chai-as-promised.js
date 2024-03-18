const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);

// By default this is false, which affects asserts like isRejected and isFulfilled.
chai.config.includeStack = true;
