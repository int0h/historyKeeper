var fsWatch = require('node-watch');
var jsdiff = require('diff');
var fs = require('fs');
require('./utils.js');
require('./hkCommon.js');

function findFilesRec(path){
	var stats = fs.statSync(path);
	if (stats.isDirectory()){
		var filePaths = [];
		fs.readdirSync(path).forEach(function(subPath){
			filePaths = filePaths.concat(findFilesRec(path + '/' + subPath));
		});
		return filePaths;
	}
	if (stats.isFile()){
		return [path];
	};
	return null;
};

function DevHistoryKeeper(options){
	options = options || {};
	this.history = {};
	this.defaultHistoryFileName = def(options.defaultHistoryFileName, 'history.json');
	this.sync = def(options.sync, true);
};

function getChanges(oldText, newText){
	var diff = jsdiff.diffChars(oldText, newText);
	var curLen = 0; // current file length
	var changes = [];
	var changedStr = oldText;
	diff.forEach(function(part){
		var change = {};
		var pos = curLen;		
		change.time = getTime();
		if (part.added){
			change.type = 'add';
			change.value = part.value;
			change.pos = curLen;
			curLen += part.count;
		} else 
		if (part.removed){
			change.type = 'remove';
			change.pos = curLen;
			change.length = part.value.length;
		} else {
			curLen += part.count;
			return;
		};
		changedStr = doChange(change, changedStr);
		change.hash = getHash(changedStr);
		//console.log(changedStr);
		changes.push(change);
	});
	return changes;
};

DevHistoryKeeper.prototype.findChange = function(path){	
	if (!this.history[path]){ // file had not been found in DB
		this.history[path] = {
			"path": path,
			"changes": [],
			"current": ''
		};
	};
	var file = this.history[path];
	if (!fs.existsSync(path)){ // file had been deleted
		file.changes.push({
			"type": 'die',
			"current": null
		});
		return;
	};
	var fileContent = fs.readFileSync('./' + path).toString();
	if (fileContent === file.current){ // file had not been changed
		return;
	};

	console.log(path + ' been changed')
	var changes = getChanges(file.current, fileContent);

	// === !checking ===

	var changedHash = changes[changes.length-1].hash;
	var newHash = getHash(fileContent);
	if (changedHash != newHash){
		//console.log(changes);
		//console.log(fileContent);
		//console.log(file.current);
		this.error('wrong changes');
	};

	// === /checking ===

	file.changes = file.changes.concat(changes);
	file.current = fileContent;
};

DevHistoryKeeper.prototype.watch = function(path, options, func){
	var self = this;
	options = options || {};
	var historyFileName = options.historyFileName || self.defaultHistoryFileName;

	function checkFilePath(filepath){
		return !options.filter || options.filter.test(filepath);
	};

	if (self.sync){
		if (fs.existsSync(historyFileName)){
			self.history = JSON.parse(fs.readFileSync(historyFileName).toString());
		};
		var files = findFilesRec(path)
			.filter(checkFilePath)
			.forEach(self.findChange.bind(self));
		self.save(historyFileName);			
		if (func){
			func(self.history);
		};	
	};

	fsWatch(path, {recursive: true}, function(filepath){
		filepath = './' + filepath;	
		if (!checkFilePath(filepath)){return};
		self.findChange(filepath);
		if (self.sync){
			self.save(historyFileName);
		};
		if (func){
			func(self.history, filepath);
		};		
	});

};

DevHistoryKeeper.prototype.save = function(historyFileName){
	historyFileName = historyFileName || this.defaultHistoryFileName;
	var jsonCode = JSON.stringify(this.history, true, 4);
	fs.writeFileSync(historyFileName, jsonCode);
};

function checkFileHistory(fileObj){
	var curText = '';
	for (var i = 0; i < fileObj.changes.length; i++){
		var change = fileObj.changes[i];
		curText = doChange(change, curText);
		//console.log(curText);
		if (change.hash != getHash(curText)){
			console.error('Bad change ID[' + i + '] in ' + fileObj.path);
			return false;
		};
	};
	return true;
};

DevHistoryKeeper.prototype.check = function(){
	for (var i in this.history){
		var file = this.history[i];
		var curHash = getHash(file.current);
		var lastHash = file.changes[file.changes.length-1].hash;
		if (curHash != lastHash){
			return false;
		};
		if (!checkFileHistory(file)){
			return false;
		};
	};
	return true;	
};



DevHistoryKeeper.prototype.error = function(infoStr){
	console.error('fatal error!');
	throw infoStr;
};

var dhk = new DevHistoryKeeper;


dhk.watch('./src', {filter: /\/[a-zA-Z0-9]*\.(js|html|htm|css)$/}, function(h,f){
	fs.writeFileSync('h.js', 'var h = ' + JSON.stringify(h, true, 4));
});
console.log(dhk.check());