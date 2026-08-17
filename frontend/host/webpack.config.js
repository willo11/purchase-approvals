const path = require('path');
const webpack = require('webpack');
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
    // CRITICAL (refresh-crash fix): must be absolute ('/'), NOT 'auto'. With
    // 'auto', HtmlWebpackPlugin injects a RELATIVE <script src="main.[hash].js">
    // which the browser resolves against the CURRENT URL — so on a deep route
    // like /requester/<id> it becomes .../requester/main.[hash].js → the dev
    // server returns index.html (MIME text/html) → strict MIME checking refuses
    // to execute it → BLANK screen on refresh. The host always lives at the
    // domain root, so '/' resolves to http://host/main.[hash].js on any route.
    // (The remotes keep 'auto' — they must resolve chunks against their OWN
    // origin when composed, which 'auto' does via the remoteEntry URL.)
    publicPath: '/',
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
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
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
    // CRITICAL (fresh-review FIX 1): replaces the `process.env.API_BASE_URL`
    // expression in src/api/client.js with its literal value at build time.
    // Without this the emitted bundle keeps a live `process.env` reference and
    // webpack 5's web target throws `process is not defined` in the browser —
    // the whole host (/, /demo, both remote compositions) is a blank page.
    // Same pattern as the requester/approver webpacks. The postbuild guard
    // (scripts/guard-no-process-env.mjs) asserts the bundle has NO leftover
    // `process.env` literal.
    new webpack.DefinePlugin({
      'process.env.API_BASE_URL': JSON.stringify(
        process.env.API_BASE_URL || 'http://localhost:4000/dev'
      ),
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
