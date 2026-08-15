const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

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
    alias: {
      // Mirrors the shadcn components.json aliases so copied components import
      // `@/lib/utils` and `@/components/ui/...` without modification.
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'approver',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/app/App',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        // Rendered inside the host's <BrowserRouter>; must resolve to the SAME
        // instance as the host so the router context survives the boundary.
        // requiredVersion mirrors the host's pin — skew fails loudly.
        'react-router-dom': {
          singleton: true,
          requiredVersion: '^6.30.4',
          strictVersion: false,
        },
      },
    }),
    new webpack.DefinePlugin({
      'process.env.API_BASE_URL': JSON.stringify(
        process.env.API_BASE_URL || 'http://localhost:4000'
      ),
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
  ],
  devServer: {
    port: 3002,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
};
