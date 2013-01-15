/**

  @module       Build
  @description  build new applications, compile client package and modules

*/
var path       = require("path");
var fs         = require("fs");
var async      = require("async");
var func       = require("func");
var iter       = require("iter");
var Base       = require("Base");
var pipe       = require("pipe").pipe;
var ujs        = require("uglify-js");
var detect     = require("detective");
var Promise    = async.Promise;
var partial    = func.partial;
var bind       = func.bind;
var map        = iter.map;
var forEach    = iter.forEach
var transport  = fs.readFileSync(__dirname + "/templates/transport.txt", "utf8");
var builtFiles = {};

/*
  @description  File object
*/
var File = Base.extend({

  properties: {
    value: {
      name: {
        type: "string"
      },
      data: {
        type: "string"
      },
      requires: {
        type: "array"
      }
    }
  },

  __init__: {

    value: function (name) {

      Base.__init__.call(this);

      this.name = name;

    }

  }

});


/*
  @description  Package object
*/
var Package = File.extend({

  properties: {
    value: {
      data: {
        set: function(value) {
          return JSON.parse(value);
        }
      }
    }
  }

});



function isBuilt (file) {

  var p = Promise.spawn();

  if (!builtFiles.hasOwnProperty(file.name)) {
    builtFiles[file.name] = true;
    p.resolve(file);
  }
  else {
    p.reject();
  }

  return p;

}


/*
  @description tests to see if a file name is an actual file
  @param       {string} name
  @return      {Promise}
  @resolves    {String}
  @rejects     {err}
*/
function isFile (name) {

  var p = Promise.spawn();

  fs.stat(name, function(err, stats) {

    if (err) {
      console.error(err.code, name);
      p.reject(err);
    }
    else {

      if (stats.isFile()) {
        p.resolve(name);
      }
      else {
        p.reject();
      }

    }

  });

  return p;

}



/*
  @description reads the file
  @param       {File} file
  @return      {Promise}
  @resolves    {File}
  @rejects     {err}
*/
function readFile (file) {

  var p = Promise.spawn();

  fs.readFile(file.name, "utf8", function(err, data) {

    if (err) {

      p.reject(err);

    }
    else {

      file.data = data;

      p.resolve(file);

    }


  });

  return p;

}



/*
  @description copies the file into htdocs
  @param       {File} file
  @return      {File}
*/
function move(file) {

  file.name = "htdocs/" + file.name;

  return file;

}



/*
  @description make a folder from a file name string
  @param       {File} file
  @return      {File}
*/
function createFolder (file) {

  jake.mkdirP(path.dirname(file.name));
  return file;

}



/*
  @description writes the file
  @param       {File} file
  @return      {Promise}
  @resolves    {File}
  @rejects     {err}
*/
function writeFile (file) {

  var p = Promise.spawn();

  fs.writeFile(file.name, file.data, "utf8", function(err) {

    if (err) {

      p.reject(err);

    }
    else {

      p.resolve(file);

    }

  });

  return p;

}



/*
  @description minify a file
  @param       {File} file
  @return      {File}
*/
function minifyFile(file) {

  file.data = ujs.minify(file.data, {
    fromString: true
  }).code;

  return file;

}



/*
  @description wraps a module in a transport file
  @param       {File} file
  @return      {File}
*/
function createTransportFile(file) {

  var i, raw, start, t;

  //  split at the first end comment block
  raw = file.data.split("*/\n");

  //  find the line at which the module start
  start = raw[0].split("\n").length;

  //  stich the module back together
  raw.shift();
  file.data = raw.join("*/\n").replace(/\n/g, "\n\t\t");

  //  insert raw module into transport
  t = transport.replace("$name", file.name.split(path.extname(file.name))[0]).replace("$body", file.data);

  //  insert the requires list and calculate the actual start position
  if(file.requires.length) {
    start = start - 6;
    t = t.replace("$requires", '"' + file.requires.join('","') + '"');
  }
  else {
    start = start - 4;
  }

  //  push the start position down. ensures line numbers match
  for(i = 0; i < start; i++) {
    t = "\n" + t;
  }

  file.data = t;

  return file;

}


/*
  @description builds a set of package dependencies
  @param       {Package} packageFile
*/
function buildDependencies (packageFile) {

  forEach(packageFile.data.dependencies, function (pack, name) {
    buildDependency("node_modules/" + name + "/package.json");
  });

}



/*
  @description builds a package
  @param       {Package} packageFile
*/
function buildPackage (packageFile) {

  if (packageFile.data.ibrokethat && packageFile.data.ibrokethat.buildClient) {
    buildModule(packageFile.name.replace("package.json", packageFile.data.main));
  }

}


/*
  @description extracts the requires
  @param       {File} file
  @return      {File} file
*/
function extractRequires (file) {

  file.requires = detect(file.data);
  return file;

}


function extractViewRequires (file) {

  var controllers = map((file.data.match(/data-controller="(\w+)"/g) || []), function (controller) {
    return "../controllers/" + (/data-controller="(\w+)"/.exec(controller)[1]);
  });

  var components = map((file.data.match(/data-component="(\w+)"/g) || []), function (component) {
    return "./" + (/data-component="(\w+)"/.exec(component)[1]);
  });

  file.requires = controllers.concat(components);

  return file;

}


/*
  @description loops through a modules requires and starts the correct build process
               package dependency, module dependency, view dependency
  @param       {File} file
  @return      {File} file
*/
function buildModuleDependencies (file) {

  forEach(file.requires, function (name) {

    switch (true) {

      case /^[\w+]/.test(name):

        buildDependency("node_modules/" + name + "/package.json");
        break;

      case /^[\.].+Component$/.test(name):

        buildView(resolvePath(file.name, name) + ".html");
        break;

      case /^[\.]/.test(name):

        buildModule(resolvePath(file.name, name) + ".js");
        break;

    }

  });

  return file;

}


function resolvePath (from, to) {

  var cwd = process.cwd();

  process.chdir(path.dirname(from));

  var name = path.resolve(to);

  name = name.split(cwd + "/")[1];

  process.chdir(cwd);

  return name;

}


function log (file) {

  console.log("build success: ", file.name)

}

var openFile = pipe([
  isFile,
  bind(File, File.spawn),
  readFile
]);


var openPackage = pipe([
  isFile,
  bind(Package, Package.spawn),
  readFile
]);


var buildDependency = pipe([
  openPackage,
  buildPackage
]);


var buildModule = pipe([
  openFile,
  isBuilt,
  extractRequires,
  buildModuleDependencies,
  createTransportFile,
  move,
  createFolder,
  writeFile,
  log
]);


var buildView = pipe([
  openFile,
  isBuilt,
  extractViewRequires,
  buildModuleDependencies,
  move,
  createFolder,
  writeFile,
  log
]);


var copyFile = pipe([
  openFile,
  move,
  createFolder,
  writeFile,
  log
]);


var buildPackageDependencies = pipe([
  openPackage,
  buildDependencies
]);

exports.buildPackageDependencies = buildPackageDependencies;
exports.buildModule = buildModule;
exports.copyFile = copyFile;
