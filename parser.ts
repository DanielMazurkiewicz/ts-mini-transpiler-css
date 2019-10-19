import * as css from 'css';

export type INames = Record<string, number[]>

export interface ISelector {
    elements: string[],
    names: INames,
    rootName?: string,
}

export interface IContent {
    [property: string]: Array<string> | string;
}

export type TRootNames = Record<string, number>;
export type TDepNames = Record<string, string[]>; // Dependancy names per root element

export interface IRule {
    media: string,
    selectors: ISelector[],
    rootNames: TRootNames,
    depNames: TDepNames,
    content: IContent,
    commonContentId: number,
}

export interface IFontFace {
    media: string,
    content: IContent,
}

export interface IKeyframe {
    media: string
    selectors: string[]
    content: IContent
}

export type TKeyframes = Record<string, IKeyframe[]>

export interface TssAst {
    fontfaces: IFontFace[]
    keyframes: TKeyframes
    rules: IRule[]
    mediaList: Record<string, number>
    commonContent: IContent[]
}

const testClassNameChar = (selector: string, position: number, namePosition: number): boolean => {
    const char = selector[position];
    if (char === '_' || char === '-' || 
        (char >= 'a' && char <= 'z') || 
        (char >= 'A' && char <= 'Z') || 
        (char >= '0' && char <= '9')) return true;

    // if (!namePosition && char === '-') return true;
    return false;
}

const splitByClassName = (selector: string): string[] => {
    const result = [];
    let position = 0, nameMode = false, quoteMode=false;
    for (let i = 0; i < selector.length; i++) {
        let char = selector[i];
        if (quoteMode) {
            if (char === '\\') 
                i++
            else if (char === '"') quoteMode = false;
        } else if (char === '.') {
            result.push(selector.substring(position, i));
            position = i;
            nameMode = true;
        } else if (char=== '"') {
            quoteMode = true;
        } else if (nameMode) {
            nameMode = testClassNameChar(selector, i, 0);
            if (!nameMode) {
                result.push(selector.substring(position, i));
                position = i;    
            }
        }
    }

    result.push(selector.substring(position));
    return result.filter(r=>r);
}

const prepareSelectorData = (selector: string): ISelector => {
    const elements = splitByClassName(selector);
    const names: INames = {};
    elements.forEach((name, index) => {
        if (name.startsWith('.')) {
            if (names[name]) {
                names[name].push(index)
            } else {
                names[name] = [index];
            }
        }
    })
    return {
        elements,
        names
    }
}

const getRootAndDepNames = (selectors: ISelector[]) => {
    const rootNames: TRootNames = {};
    const depNames: TDepNames = {};
    selectors.forEach(s => {
        let rootName: string = '';
        for (let name in s.names) {
            if (rootName) {
                depNames[rootName].push(name)
            } else {
                rootName = name;
                if (rootNames[rootName]) {
                    rootNames[rootName]++;
                } else {
                    rootNames[rootName] = 1;
                    depNames[rootName] = [];
                }
            }

        }
        s.rootName = rootName;
        if (!rootName) {
            if (rootNames[rootName]) {
                rootNames[rootName]++;
            } else {
                rootNames[rootName] = 1;
            } 
        }
    });
    return {
        rootNames, depNames
    }
}

const getTsMiniName = (name: string) => name.replace(/\-/g, '_');

const getStyle = (declarations: any): IContent => {
    const content: IContent = {}
    declarations.forEach((d: any) => {

        if (d.type === 'declaration') {
            const property = getTsMiniName(d.property);
            const oldValue = content[property];
            
            if (oldValue) {
                if (Array.isArray(oldValue)) {
                    oldValue.push(d.value)
                } else {
                    content[property] = [oldValue, d.value];
                }
            } else {
                content[property] = d.value;
            }
        }
    });
    return content
}

const parse = (element: any, result: TssAst = {rules: [], mediaList: {}, commonContent: [], keyframes: {}, fontfaces: []}, media = '') => {
    switch (element.type) {
        case "media":
            media = element.media;
            element.rules.forEach((r: any) => {
                parse(r, result, media);
            });
            break;
        case "stylesheet":
            element.stylesheet.rules.forEach((r: any) => {
                parse(r, result, media);
            });
            break;
        case "rule":
            const selectors: ISelector[] = element.selectors.map((s: any) => prepareSelectorData(s));
            const {rootNames, depNames} = getRootAndDepNames(selectors);
            const content = getStyle(element.declarations);

            const rules: IRule = {
                media,
                selectors,
                rootNames,
                depNames,
                content,
                commonContentId: -1
            }
            result.rules.push(rules)
            if (result.mediaList[media]) {
                result.mediaList[media]++;
            } else {
                result.mediaList[media] = 1;
            }
            break;
        case "keyframes":
            if (!result.keyframes[element.name]) result.keyframes[element.name] = [];
            element.keyframes.forEach((keyframe: any) => {
                result.keyframes[element.name].push({
                    media,
                    selectors: keyframe.values,
                    content: getStyle(keyframe.declarations)
                });
            })
            break;
        case "font-face":
            result.fontfaces.push({
                media,
                content: getStyle(element.declarations)
            });
            break;
    }
    return result;
}


export const parseCss = (input: string) => {
    const parsed = css.parse(input);

    // const { parsingErrors } = parsed.stylesheet;
    // console.log(parsed)
    return parse(parsed);
}