import fetch from 'node-fetch'
import { parse, ChildNode } from 'postcss'
import * as cs from 'color-string'
import * as unzipper from 'unzipper'
import { builder } from '@netlify/functions'
import type { BuilderHandler } from '@netlify/functions/dist/function/handler'

let HEADERS = {
  'Access-Control-Allow-Headers':
    'Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Origin',
  'Content-Type': 'text/plain',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Max-Age': '8640',
  'Access-Control-Allow-Origin': '*',
  Vary: 'Origin',
}

type Options = {
  repo: string
  owner: string
  branch: string
}

const cssLangReg = new RegExp(`\\.(css)($|\\?)`)
const toTwoDimensional = (arr: string[], size: number) =>
  arr.flatMap((_, i, a) => (i % size ? [] : [a.slice(i, i + size)]))
const isCSSRequest = (request: string): boolean => cssLangReg.test(request)
const getSearchParams = (url: string): Options | null => {
  const { searchParams } = new URL(url)

  if (
    !searchParams.has('repo') ||
    !searchParams.has('owner') ||
    !searchParams.has('branch')
  ) {
    return null
  }

  return {
    repo: searchParams.get('repo') || '',
    owner: searchParams.get('owner') || '',
    branch: searchParams.get('branch') || '',
  }
}

const toSvgAsString = (twoDimensionalHexColors: string[][]) => {
  let svgAsString = `<svg
  width="${64 * 10}"
  height="${64 * twoDimensionalHexColors.length}"
  viewBox="0 0 ${64 * 10} ${64 * twoDimensionalHexColors.length}"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>`

  for (let i = 0; i < twoDimensionalHexColors.length; i++) {
    for (let j = 0; j < twoDimensionalHexColors[i].length; j++) {
      svgAsString = `${svgAsString}<rect x="${j * 64}" y="${
        i * 64
      }" width="64" height="64" fill="${twoDimensionalHexColors[i][j]}" />`
    }
  }

  svgAsString = `${svgAsString}</svg>`

  return svgAsString
}

const recursion = (nodes: ChildNode[]): Set<string> => {
  const hexColors = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'rule') {
      for (const hexColor of recursion(node.nodes)) {
        hexColors.add(hexColor)
      }
    } else if (node.type === 'decl') {
      const { value } = node
      const matchedArr = value.match(
        /(^#{1}[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$)|(rgba?\( *([+-]?\d*\.?\d+) *, *([+-]?\d*\.?\d+) *, *([+-]?\d*\.?\d+)(?: *, *([+-]?\d*\.?\d+) *)?\)$)/gi,
      )

      if (matchedArr?.length) {
        for (const matched of matchedArr) {
          const color = cs.get(matched)
          if (color) {
            hexColors.add(cs.to.hex(color!.value))
          }
        }
      }
    }
  }

  return hexColors
}

const main = async (options: Options) => {
  // https://docs.github.com/ja/rest/repos/contents?apiVersion=2022-11-28#download-a-repository-archive-zip
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/zipball/${options.branch}`,
  )
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const directoryFromBuffer = await unzipper.Open.buffer(buffer)

  const hexColors = new Set<string>()
  for (const file of directoryFromBuffer.files) {
    if (isCSSRequest(file.path)) {
      const fileBuffer = await file.buffer()
      for (const hexColor of recursion(parse(fileBuffer.toString()).nodes)) {
        hexColors.add(hexColor)
      }
    }
  }

  return toSvgAsString(toTwoDimensional(Array.from(hexColors), 10))
}

const handler: BuilderHandler = async (event, context) => {
  const options = getSearchParams(event.rawUrl)

  if (!options) {
    return {
      statusCode: 400,
    }
  }

  try {
    const svgAsString = await main(options)

    return {
      statusCode: 200,
      body: svgAsString,
      HEADERS,
    }
  } catch (e) {
    console.log('e :>> ', e)
    return {
      statusCode: 500,
    }
  }
}

exports.handler = builder(handler)
