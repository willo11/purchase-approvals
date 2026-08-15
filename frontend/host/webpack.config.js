const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    publicPath: 'auto',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'host',
      remotes: {
        requester: 'requester@http://localhost:3001/remoteEntry.js',
        approver: 'approver@http://localhost:3002/remoteEntry.js',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        // The requester/approver remotes render their own <Routes> inside the
        // host's <BrowserRouter>. They MUST resolve the SAME react-router-dom
        // instance, otherwise the router context is lost across the boundary.
        // requiredVersion pins both sides to the same range so version skew
        // fails loudly at runtime instead of silently using whichever loads
        // first (strictVersion:false allows a compatible fallback).
        'react-router-dom': {
          singleton: true,
          requiredVersion: '^6.30.4',
          strictVersion: false,
        },
      },
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
  ],
  devServer: {
    port: 3000,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
};
