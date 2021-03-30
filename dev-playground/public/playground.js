// var app = angular.module('pdfmake', ['ngRoute']);

// app.config(function ($routeProvider) {
// 	$routeProvider
// 		.when('/', {
// 			templateUrl: 'index.html',
// 			controller: 'PlaygroundController'
// 		})
// 		.otherwise({ redirectTo: '/' });
// });
const react2angular  =  require('react2angular');
const Playground = require('./../../components/playground');

var app=angular
  .module('pdfmake', [])
  .component('Playground', react2angular(Playground, ['ngRoute']))

  app.config(function ($routeProvider) {
	$routeProvider
		.when('/', {
			templateUrl: 'index.html',
			controller: 'PlaygroundController'
		})
		.otherwise({ redirectTo: '/' });
});