# pug-extract-loader
[![npm version](https://badge.fury.io/js/pug-extract-loader.svg)](https://badge.fury.io/js/pug-extract-loader)

Webpack loader to extract pug to HTML, calling all dependencies found in the code

This loader is projected to be appended to [pug-loader](https://github.com/pugjs/pug-loader)  
[File-loader](https://github.com/webpack-contrib/file-loader) can be appended to this loader

## Usage


``` javascript
    {
        test: /\.pug$/,
        loaders: [
            {loader: "file-loader", options: {context: path.resolve(__dirname, 'src', 'views', 'pages'), name: '[path][name].html'}}
            {loader: 'pug-extract-loader', options: {locals: {pugVars}}},
            {loader: 'pug-loader', options: {pretty: true, doctype: 'html'}},
        ]
    }
```
