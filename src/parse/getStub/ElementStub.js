define([
	'config/types',
	'utils/isArray',
	'config/voidElementNames',
	'parse/getStub/utils/stringifyStubs',
	'parse/getStub/utils/jsonifyStubs'
], function (
	types,
	isArray,
	voidElementNames,
	stringifyStubs,
	jsonifyStubs
) {

	'use strict';

	var ElementStub,

		// dependencies
		getFragmentStubFromTokens,
		getItem,
		
		// helpers
		allElementNames,
		mapToLowerCase,
		svgCamelCaseElements,
		svgCamelCaseElementsMap,
		svgCamelCaseAttributes,
		svgCamelCaseAttributesMap,
		closedByParentClose,
		siblingsByTagName,
		onPattern,
		sanitize,
		filterAttrs,
		getFrag,
		processDirective,
		jsonifyDirective,
		camelCase,
		deepClone,
		leadingWhitespace = /^\s+/,
		trailingWhitespace = /\s+$/;

	loadCircularDependency( function () {
		// TODO circular dependency
		require([ 'parse/getStub/getFragmentStubFromTokens', 'parse/getStub/utils/getItem' ], function ( dep1, dep2 ) {
			getFragmentStubFromTokens = dep1;
			getItem = dep2;
		});
	});

	ElementStub = function ( firstToken, parser, preserveWhitespace ) {
		var next, attrs, filtered, proxies, item, i, attr;

		this.lcTag = firstToken.name.toLowerCase();

		parser.pos += 1;

		// TODO is this the right way to deal with component naming?
		if ( this.lcTag.substr( 0, 3 ) === 'rv-' ) {
			this.component = camelCase( firstToken.name.substring( 3 ) );

			if ( firstToken.attrs ) {
				this.attributes = [];
				i = firstToken.attrs.length;
				while ( i-- ) {
					attr = firstToken.attrs[i];

					this.attributes[i] = {
						name: attr.name,
						value: attr.value ? getFragmentStubFromTokens( attr.value ) : null
					};
				}
			}
		}

		else {
			// enforce lower case tag names by default. HTML doesn't care. SVG does, so if we see an SVG tag
			// that should be camelcased, camelcase it
			this.tag = ( svgCamelCaseElementsMap[ this.lcTag ] ? svgCamelCaseElementsMap[ this.lcTag ] : this.lcTag );

			// if this is a <pre> element, preserve whitespace within
			preserveWhitespace = ( preserveWhitespace || this.lcTag === 'pre' );

			if ( firstToken.attrs ) {
				filtered = filterAttrs( firstToken.attrs );
				
				attrs = filtered.attrs;
				proxies = filtered.proxies;

				// remove event attributes (e.g. onclick='doSomething()') if we're sanitizing
				if ( parser.options.sanitize && parser.options.sanitize.eventAttributes ) {
					attrs = attrs.filter( sanitize );
				}

				if ( attrs.length ) {
					this.attributes = attrs.map( getFrag );
				}

				if ( proxies.length ) {
					this.proxies = proxies.map( processDirective );
				}

				// TODO rename this helper function
				if ( filtered.intro ) {
					this.intro = processDirective( filtered.intro );
				}

				if ( filtered.outro ) {
					this.outro = processDirective( filtered.outro );
				}

				if ( filtered.decorator ) {
					// TODO figure out the syntax for decorators - can we have multiple
					// decorators? Decorators with arguments?
					this.decorator = filtered.decorator.value[0].value;
				}
			}
		}
		
		if ( firstToken.doctype ) {
			this.doctype = true;
		}

		if ( firstToken.selfClosing ) {
			this.selfClosing = true;
		}

		if ( voidElementNames.indexOf( this.lcTag ) !== -1 ) {
			this.isVoid = true;
		}

		// if self-closing or a void element, close
		if ( this.selfClosing || this.isVoid ) {
			return;
		}

		this.siblings = siblingsByTagName[ this.lcTag ];

		this.items = [];

		next = parser.next();
		while ( next ) {

			// section closing mustache should also close this element, e.g.
			// <ul>{{#items}}<li>{{content}}{{/items}}</ul>
			if ( next.mustacheType === types.CLOSING ) {
				break;
			}
			
			if ( next.type === types.TAG ) {

				// closing tag
				if ( next.closing ) {
					// it's a closing tag, which means this element is closed...
					if ( next.name.toLowerCase() === this.lcTag ) {
						parser.pos += 1;
					}

					break;
				}

				// sibling element, which closes this element implicitly
				else if ( this.siblings && ( this.siblings.indexOf( next.name.toLowerCase() ) !== -1 ) ) {
					break;
				}
				
			}

			this.items[ this.items.length ] = getItem( parser );

			next = parser.next();
		}


		// if we're not preserving whitespace, we can eliminate inner leading and trailing whitespace
		if ( !preserveWhitespace ) {
			item = this.items[0];
			if ( item && item.type === types.TEXT ) {
				item.text = item.text.replace( leadingWhitespace, '' );
				if ( !item.text ) {
					this.items.shift();
				}
			}

			item = this.items[ this.items.length - 1 ];
			if ( item && item.type === types.TEXT ) {
				item.text = item.text.replace( trailingWhitespace, '' );
				if ( !item.text ) {
					this.items.pop();
				}
			}
		}
	};

	ElementStub.prototype = {
		toJSON: function ( noStringify ) {
			var json, name, value, proxy, i, len;

			if ( this[ 'json_' + noStringify ] ) {
				return this[ 'json_' + noStringify ];
			}

			if ( this.component ) {
				json = {
					t: types.COMPONENT,
					e: this.component
				};
			} else {
				json = {
					t: types.ELEMENT,
					e: this.tag
				};
			}

			if ( this.doctype ) {
				json.y = 1;
			}

			if ( this.attributes && this.attributes.length ) {
				json.a = {};

				len = this.attributes.length;
				for ( i=0; i<len; i+=1 ) {
					name = this.attributes[i].name;

					if ( json.a[ name ] ) {
						throw new Error( 'You cannot have multiple attributes with the same name' );
					}

					// empty attributes (e.g. autoplay, checked)
					if( this.attributes[i].value === null ) {
						value = null;
					} else {
						value = jsonifyStubs( this.attributes[i].value.items, noStringify );	
					}

					json.a[ name ] = value;
				}
			}

			if ( this.items && this.items.length ) {
				json.f = jsonifyStubs( this.items, noStringify );
			}

			if ( this.proxies && this.proxies.length ) {
				json.v = {};

				len = this.proxies.length;
				for ( i=0; i<len; i+=1 ) {
					proxy = this.proxies[i];
					json.v[ proxy.directiveType ] = jsonifyDirective( proxy );
				}
			}

			if ( this.intro ) {
				json.t1 = jsonifyDirective( this.intro );
			}

			if ( this.outro ) {
				json.t2 = jsonifyDirective( this.outro );
			}

			if ( this.decorator ) {
				json.o = this.decorator;
			}

			this[ 'json_' + noStringify ] = json;
			return json;
		},

		toString: function () {
			var str, i, len, attrStr, name, attrValueStr, fragStr, isVoid;

			if ( this.str !== undefined ) {
				return this.str;
			}

			// components can't be stringified
			if ( this.component ) {
				return ( this.str = false );
			}

			// if this isn't an HTML element, it can't be stringified (since the only reason to stringify an
			// element is to use with innerHTML, and SVG doesn't support that method.
			// Note: table elements and select children are excluded from this, because IE (of course)
			// fucks up when you use innerHTML with them
			if ( allElementNames.indexOf( this.tag.toLowerCase() ) === -1 ) {
				return ( this.str = false );
			}

			// do we have proxies or transitions? if so we can't use innerHTML
			if ( this.proxies || this.intro || this.outro ) {
				return ( this.str = false );
			}

			// see if children can be stringified (i.e. don't contain mustaches)
			fragStr = stringifyStubs( this.items );
			if ( fragStr === false ) {
				return ( this.str = false );
			}

			// is this a void element?
			isVoid = ( voidElementNames.indexOf( this.tag.toLowerCase() ) !== -1 );

			str = '<' + this.tag;
			
			if ( this.attributes ) {
				for ( i=0, len=this.attributes.length; i<len; i+=1 ) {

					name = this.attributes[i].name;
					
					// does this look like a namespaced attribute? if so we can't stringify it
					if ( name.indexOf( ':' ) !== -1 ) {
						return ( this.str = false );
					}

					// if this element has an id attribute, it can't be stringified (since references are stored
					// in ractive.nodes). Similarly, intro and outro transitions
					if ( name === 'id' || name === 'intro' || name === 'outro' ) {
						return ( this.str = false );
					}

					attrStr = ' ' + name;

					// empty attributes
					if ( this.attributes[i].value !== null ) {
						attrValueStr = this.attributes[i].value.toString();

						if ( attrValueStr === false ) {
							return ( this.str = false );
						}

						if ( attrValueStr !== '' ) {
							attrStr += '=';

							// does it need to be quoted?
							if ( /[\s"'=<>`]/.test( attrValueStr ) ) {
								attrStr += '"' + attrValueStr.replace( /"/g, '&quot;' ) + '"';
							} else {
								attrStr += attrValueStr;
							}
						}
					}

					str += attrStr;
				}
			}

			// if this isn't a void tag, but is self-closing, add a solidus. Aaaaand, we're done
			if ( this.selfClosing && !isVoid ) {
				str += '/>';
				return ( this.str = str );
			}

			str += '>';

			// void element? we're done
			if ( isVoid ) {
				return ( this.str = str );
			}

			// if this has children, add them
			str += fragStr;

			str += '</' + this.tag + '>';
			return ( this.str = str );
		}
	};


	allElementNames = 'a abbr acronym address applet area b base basefont bdo big blockquote body br button caption center cite code col colgroup dd del dfn dir div dl dt em fieldset font form frame frameset h1 h2 h3 h4 h5 h6 head hr html i iframe img input ins isindex kbd label legend li link map menu meta noframes noscript object ol p param pre q s samp script select small span strike strong style sub sup textarea title tt u ul var article aside audio bdi canvas command data datagrid datalist details embed eventsource figcaption figure footer header hgroup keygen mark meter nav output progress ruby rp rt section source summary time track video wbr'.split( ' ' );
	closedByParentClose = 'li dd rt rp optgroup option tbody tfoot tr td th'.split( ' ' );

	svgCamelCaseElements = 'altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath vkern'.split( ' ' );
	svgCamelCaseAttributes = 'attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits contentScriptType contentStyleType diffuseConstant edgeMode externalResourcesRequired filterRes filterUnits glyphRef glyphRef gradientTransform gradientTransform gradientUnits gradientUnits kernelMatrix kernelUnitLength kernelUnitLength kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent specularExponent spreadMethod spreadMethod startOffset stdDeviation stitchTiles surfaceScale surfaceScale systemLanguage tableValues targetX targetY textLength textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan'.split( ' ' );
	
	mapToLowerCase = function ( items ) {
		var map = {}, i = items.length;
		while ( i-- ) {
			map[ items[i].toLowerCase() ] = items[i];
		}
		return map;
	};

	svgCamelCaseElementsMap = mapToLowerCase( svgCamelCaseElements );
	svgCamelCaseAttributesMap = mapToLowerCase( svgCamelCaseAttributes );

	siblingsByTagName = {
		li: [ 'li' ],
		dt: [ 'dt', 'dd' ],
		dd: [ 'dt', 'dd' ],
		p: 'address article aside blockquote dir div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr menu nav ol p pre section table ul'.split( ' ' ),
		rt: [ 'rt', 'rp' ],
		rp: [ 'rp', 'rt' ],
		optgroup: [ 'optgroup' ],
		option: [ 'option', 'optgroup' ],
		thead: [ 'tbody', 'tfoot' ],
		tbody: [ 'tbody', 'tfoot' ],
		tr: [ 'tr' ],
		td: [ 'td', 'th' ],
		th: [ 'td', 'th' ]
	};

	onPattern = /^on[a-zA-Z]/;

	sanitize = function ( attr ) {
		var valid = !onPattern.test( attr.name );
		return valid;
	};

	filterAttrs = function ( items ) {
		var attrs, proxies, filtered, i, len, item;

		filtered = {};
		attrs = [];
		proxies = [];

		len = items.length;
		for ( i=0; i<len; i+=1 ) {
			item = items[i];

			// Transition?
			if ( item.name === 'intro' ) {
				if ( filtered.intro ) {
					throw new Error( 'An element can only have one intro transition' );
				}

				filtered.intro = item;
			} else if ( item.name === 'outro' ) {
				if ( filtered.outro ) {
					throw new Error( 'An element can only have one outro transition' );
				}

				filtered.outro = item;
			} else if ( item.name === 'intro-outro' ) {
				if ( filtered.intro || filtered.outro ) {
					throw new Error( 'An element can only have one intro and one outro transition' );
				}

				filtered.intro = item;
				filtered.outro = deepClone( item );
			}

			// Proxy?
			else if ( item.name.substr( 0, 6 ) === 'proxy-' ) {
				item.name = item.name.substring( 6 );
				proxies[ proxies.length ] = item;
			}

			else if ( item.name.substr( 0, 3 ) === 'on-' ) {
				item.name = item.name.substring( 3 );
				proxies[ proxies.length ] = item;
			}

			// Decorator?
			else if ( item.name === 'decorator' ) {
				filtered.decorator = item;
			}

			// Attribute?
			else {
				attrs[ attrs.length ] = item;
			}
		}

		filtered.attrs = attrs;
		filtered.proxies = proxies;

		return filtered;
	};

	getFrag = function ( attr ) {
		var lcName = attr.name.toLowerCase();

		return {
			name: ( svgCamelCaseAttributesMap[ lcName ] ? svgCamelCaseAttributesMap[ lcName ] : lcName ),
			value: attr.value ? getFragmentStubFromTokens( attr.value ) : null
		};
	};

	processDirective = function ( directive ) {
		var processed, tokens, token, colonIndex, throwError, directiveName, directiveArgs;

		throwError = function () {
			throw new Error( 'Illegal directive' );
		};

		if ( !directive.name || !directive.value ) {
			throwError();
		}

		processed = { directiveType: directive.name };

		tokens = directive.value;

		directiveName = [];
		directiveArgs = [];

		while ( tokens.length ) {
			token = tokens.shift();

			if ( token.type === types.TEXT ) {
				colonIndex = token.value.indexOf( ':' );
				
				if ( colonIndex === -1 ) {
					directiveName[ directiveName.length ] = token;
				} else {
					
					// is the colon the first character?
					if ( colonIndex ) {
						// no
						directiveName[ directiveName.length ] = {
							type: types.TEXT,
							value: token.value.substr( 0, colonIndex )
						};
					}

					// if there is anything after the colon in this token, treat
					// it as the first token of the directiveArgs fragment
					if ( token.value.length > colonIndex + 1 ) {
						directiveArgs[0] = {
							type: types.TEXT,
							value: token.value.substring( colonIndex + 1 )
						};
					}

					break;
				}
			}

			else {
				directiveName[ directiveName.length ] = token;
			}
		}

		directiveArgs = directiveArgs.concat( tokens );

		if ( directiveName.length === 1 && directiveName[0].type === types.TEXT ) {
			processed.name = directiveName[0].value;
		} else {
			processed.name = directiveName;
		}

		if ( directiveArgs.length ) {
			if ( directiveArgs.length === 1 && directiveArgs[0].type === types.TEXT ) {
				try {
					processed.args = JSON.parse( directiveArgs[0].value );
				} catch ( err ) {
					processed.args = directiveArgs[0].value;
				}
			}

			else {
				processed.dynamicArgs = directiveArgs;
			}
		}

		return processed;
	};

	jsonifyDirective = function ( directive ) {
		var result, name;

		if ( typeof directive.name === 'string' ) {
			if ( !directive.args && !directive.dynamicArgs ) {
				return directive.name;
			}

			name = directive.name;
		} else {
			name = getFragmentStubFromTokens( directive.name ).toJSON();
		}

		result = { n: name };

		if ( directive.args ) {
			result.a = directive.args;
			return result;
		}

		if ( directive.dynamicArgs ) {
			result.d = getFragmentStubFromTokens( directive.dynamicArgs ).toJSON();
		}

		return result;
	};

	camelCase = function ( hyphenatedStr ) {
		return hyphenatedStr.replace( /-([a-zA-Z])/g, function ( match, $1 ) {
			return $1.toUpperCase();
		});
	};

	deepClone = function ( obj ) {
		var result, key;

		if ( typeof obj !== 'object' ) {
			return obj;
		}

		if ( isArray( obj ) ) {
			return obj.map( deepClone );
		}

		result = {};
		for ( key in obj ) {
			if ( obj.hasOwnProperty( key ) ) {
				result[ key ] = deepClone( obj[ key ] );
			}
		}

		return result;
	};

	return ElementStub;

});