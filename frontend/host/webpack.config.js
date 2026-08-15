const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

// Remote URLs are read at BUILD TIME from the environment so a deployed host
// bundle can point at the real remote origins (S3/CloudFront) instead of the
// local dev servers. Local defaults keep `pnpm run dev:front` unchanged.
//   REQUESTER_REMOTE_URL=https://requester.example.com/remoteEntry.js \
//   APPROVER_REMOTE_URL=https://approver.example.com/remoteEntry.js \
//   pnpm -C frontend/host run build
const requesterRemoteUrl =
  process.env.REQUESTER_REMOTE_URL ?? 'http://localhost:3001/remoteEntry.js';
const approverRemoteUrl =
  process.env.APPROVER_REMOTE_URL ?? 'http://localhost:3002/remoteEntry.js';

module.exports = {
  entry: './src/app/index.js',
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
        requester: `requester@${requesterRemoteUrl}`,
        approver: `approver@${approverRemoteUrl}`,
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
