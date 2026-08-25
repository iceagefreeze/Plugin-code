import webpack from 'webpack'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
export default function defineWebpackConfig(config) {
  config.module = config.module || {}
  config.module.rules = [{ test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: join(root, 'tools/tsx-loader.cjs') }] }]
  config.plugins = [new webpack.DefinePlugin({ 'process.env.VERSION': JSON.stringify('1.0.0') }), ...(config.plugins || [])]
  return config
}
