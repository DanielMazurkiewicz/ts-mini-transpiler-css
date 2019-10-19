import { parseCss, TssAst, IRule, IContent } from './parser';



const stage1 = (ast: TssAst) => {
    // Stage 1: Extracting common contents and splitting roots
    const rules: IRule[] = [];
    ast.rules.forEach(r => {
        const rootNames = Object.keys(r.rootNames);
        if (rootNames.length > 1) {
            const commonContentId = ast.commonContent.length;
            ast.commonContent.push(r.content);

            rootNames.forEach(n => {
                const clone: IRule = {
                    media: r.media,
                    content: {},
                    selectors: r.selectors.filter(s => s.rootName === n),
                    rootNames: {[n]: r.rootNames[n]},
                    depNames: {[n]: r.depNames[n]},
                    commonContentId
                }
                rules.push(clone)
            })    
        } else {
            rules.push(r);
        }
    });
    ast.rules = rules;
    return ast;
}

interface ICollection {
    name: string
    count: number
    rules: IRule[]
    dependencies: Record<string, boolean>
    dependants: number
    visited?: boolean
}

const stage2 = (ast: TssAst) => {
    // Stage 2: Setting up collections
    const collections: Record<string, ICollection> = {}
    ast.rules.forEach(r => {
        const name = Object.keys(r.rootNames)[0];

        const dependencies: Record<string, boolean> = {}
        if (r.depNames[name]) r.depNames[name].forEach(n => {
            dependencies[n] = true
            if (!collections[n]) {
                collections[n] = {
                    name: n,
                    count: 0,
                    rules: [],
                    dependencies: {},
                    dependants: 0
                }
            }
        });

        let collection = collections[name];
        if (!collection) {
            collections[name] = {
                name,
                count: 1,
                rules: [r],
                dependencies,
                dependants: 0
            }
        } else {
            collection.count++;
            collection.rules.push(r);
            Object.assign(collection.dependencies, dependencies)
        }
    });

    return collections;
}

const stage3 = (collections: Record<string, ICollection>) => {
    // Stage 3: Placing collections in correct order
    for (let name in collections) {
        const collection = collections[name];
        for (let dName in collection.dependencies) {
            collections[dName].dependants++;
        }
    }
    const startingPoints = Object.values(collections).filter(o => !o.dependants);

    const orderedCollection: ICollection[] = [];
    const traverse = (collection: ICollection) => {
        if (collection.visited) return;
        collection.visited = true;
        for (let name in collection.dependencies) {
            traverse(collections[name]);
        }
        orderedCollection.push(collection);
    }

    startingPoints.forEach(p => {
        traverse(p);
    })
    return orderedCollection;
}


// COMPILATION


const prepareString = (text: string) => '`' + text.replace(/\$/g, '\\$').replace(/\`/g, '\\`') + '`';

const getPropertyName = (prop: string, pad: number = 0) => (prop + ':').padEnd(pad);

const stringifyContent = (content: any, maxPadSize = 24, sep = '\n'): string => {
    let result = '', padSize = 0;
    for (let property in content) padSize = (property.length > padSize ? property.length : padSize);
    if (padSize > maxPadSize) padSize = maxPadSize;

    for (let property in content) {
        const value = content[property];
        if (Array.isArray(value)) {
            result += `  ${getPropertyName(property, padSize + 1)} [` + value.map(v => prepareString(v)).join(',') + `],${sep}`
        } else if (value && value.$ !== undefined) {
            result += `  ${getPropertyName(property, padSize + 1)} ${value.$},${sep}`
        } else {
            result += `  ${getPropertyName(property, padSize + 1)} ${prepareString(<string> content[property])},${sep}`
        }
    }
    return `{${sep}${result}}`;
}

const getTssName = (name: string) => name.substr(1).replace(/\-/g, '_');

const prepareNamedSelector = (r: IRule) => {
    const selectors = r.selectors.map(s => {
        if (s.elements.length === 1) return '';
        if (s.elements.length === 2) {
            if (s.rootName === s.elements[0] && s.elements[1].startsWith(' ')) return s.elements[1].trim();
            if (s.rootName === s.elements[1] && s.elements[0].endsWith(' ')) return '<' + s.elements[0].trim();
        }

        const paramsList: string[] = [];
        const selector = s.elements.map(e => {
            if (e.startsWith('.')) {
                if (e === s.rootName) return '@';
                paramsList.push(e)
                return '%';
            }
            return e;
        }).join('');
        if (paramsList.length) {
            const params = paramsList.map(p => getTssName(p)).join(', ');
            return {$: `query(${prepareString(selector)}, ${params})`};    
        }
        return '=' + selector
    }).filter(s=>s).map((s: string | any) => { 
        if (s.$) return s.$
        return prepareString(s)
    })
    if (!selectors.length) return '';
    return (selectors.length === 1) ? selectors[0] : `[${selectors.join(', ')}]`
}


const compileKeyframes = (ast: TssAst) => {
    const { keyframes } =  ast;
    let result = '';
    for (let name in keyframes) {
        const keyframe = keyframes[name];
        result += `tssFrames(${prepareString(name)}, `
        result += keyframe.map(r => {
            const base: any = r.media ? { MEDIA: {$: mediaPrefix + ast.mediaList[r.media]}} : {};
            const selector = r.selectors.join(',');
            base.SELECTOR = selector;
            return stringifyContent(Object.assign(base, r.content));
        }).join(', ')
        result += `);\n`
    }
    return result;
}

const compileFontfaces = (ast: TssAst) => {
    const { fontfaces } =  ast;
    let result = '';
    fontfaces.forEach(fontface => {
        result += `tss('@fontface', `
        const base: any = fontface.media ? { MEDIA: {$: mediaPrefix + ast.mediaList[fontface.media]}} : {};
        result += stringifyContent(Object.assign(base, fontface.content));
        result += `);\n`

    });
    return result;
}


const commonPrefix = 'tssCommon__';
const mediaPrefix = 'tssMedia__';
const compile = (orderedCollection: ICollection[], ast: TssAst) => {
    let result = 'import { tss, tssFrames, tssFont, join, query } from "ts-mini/tss";\n';

    let mediaId = 0;
    for (let media in ast.mediaList) {
        ast.mediaList[media] = mediaId;
        if (media) result += `const ${mediaPrefix}${mediaId} = \`${media}\`;\n`
        mediaId++;
    }

    result += '\n';
    result += compileKeyframes(ast);

    result += '\n';
    result += compileFontfaces(ast);

    ast.commonContent.forEach((c, i) => {
        result += `const ${commonPrefix}${i} = `;
        result += stringifyContent(c) + '\n';
    });

    result += '\n';

    orderedCollection.forEach(collection => {
        if (collection.name) {
            result += `export const ${getTssName(collection.name)} = tss(`;
            result += collection.rules.map(r => {

                const base: any = r.media ? { MEDIA: {$: mediaPrefix + ast.mediaList[r.media]}} : {};
                const selector = prepareNamedSelector(r);
                if (selector) base.SELECTOR = {$:selector};

                if (r.commonContentId >= 0) {
                    if (Object.keys(base).length) {
                        return `join(${stringifyContent(base, 0, '')}, ${commonPrefix}${r.commonContentId})`
                    }
                    return `${commonPrefix}${r.commonContentId}`
                } else {
                    return stringifyContent(Object.assign(base, r.content));
                }
            }).join(', ')
            result += `);\n\n`;
        } else {
            result += `tss(`;

            result += collection.rules.map(r => {

                const base: any = r.media ? { MEDIA: {$: mediaPrefix + ast.mediaList[r.media]}} : {};
                const selector = '=' + r.selectors.map(s => s.elements[0]).join();
                base.SELECTOR = selector;

                if (r.commonContentId >= 0) {
                    if (Object.keys(base).length) {
                        return `join(${stringifyContent(base, 0, '')}, ${commonPrefix}${r.commonContentId})`
                    }
                    return `${commonPrefix}${r.commonContentId}`
                } else {
                    return stringifyContent(Object.assign(base, r.content));
                }
            }).join(', ')

            result += `);\n\n`;
        }
    });
    return result;
}

export const transpileCss = (input: string): string => {
    let result = '';
    const ast = parseCss(input);
    const stage1res = stage1(ast);
    const stage2res = stage2(stage1res);
    const stage3res = stage3(stage2res);
    const compiled = compile(stage3res, ast);
    result += compiled;
    // result += '\n==============================================\n';
    // // result += JSON.stringify(stage3res, null, 3);
    // result += '\n==============================================\n';
    // result += JSON.stringify(ast, null, 3);
    // result += '\n==============================================\n';

    return result;
}

export const transpile = transpileCss;