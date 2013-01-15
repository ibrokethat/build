var assert  = require("assert");
var sinon   = require("sinon");
var Base    = require("../Base");
var fakes;

describe("test build package: ", function() {


  beforeEach(function() {

    fakes = sinon.sandbox.create();

  });

  afterEach(function() {

    fakes.restore();
    Proto = null;

  });



});
