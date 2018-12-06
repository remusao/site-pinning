import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';


const plugins = [
  resolve(),
  commonjs(),
];

export default [
  {
    input: './build/background.js',
    output: {
      file: 'background.iife.js',
      name: 'siteLock',
      format: 'cjs',
    },
    plugins,
  },
  {
    input: './build/popup.js',
    output: {
      file: 'popup.iife.js',
      name: 'siteLock',
      format: 'cjs',
    },
    plugins,
  },
  {
    input: './build/content.js',
    output: {
      file: 'content.iife.js',
      format: 'iife',
    },
    plugins,
  },
];
