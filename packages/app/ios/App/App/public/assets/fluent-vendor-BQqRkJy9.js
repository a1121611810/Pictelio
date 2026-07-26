function e(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a}var t=class{constructor(e,t,n=!1){this.evaluate=e,this.policy=t,this.isVolatile=n}},n;(function(e){e[e.needsArrayObservation=1101]=`needsArrayObservation`,e[e.onlySetDOMPolicyOnce=1201]=`onlySetDOMPolicyOnce`,e[e.bindingInnerHTMLRequiresTrustedTypes=1202]=`bindingInnerHTMLRequiresTrustedTypes`,e[e.twoWayBindingRequiresObservables=1203]=`twoWayBindingRequiresObservables`,e[e.hostBindingWithoutHost=1204]=`hostBindingWithoutHost`,e[e.unsupportedBindingBehavior=1205]=`unsupportedBindingBehavior`,e[e.directCallToHTMLTagNotAllowed=1206]=`directCallToHTMLTagNotAllowed`,e[e.onlySetTemplatePolicyOnce=1207]=`onlySetTemplatePolicyOnce`,e[e.cannotSetTemplatePolicyAfterCompilation=1208]=`cannotSetTemplatePolicyAfterCompilation`,e[e.blockedByDOMPolicy=1209]=`blockedByDOMPolicy`,e[e.invalidHydrationAttributeMarker=1210]=`invalidHydrationAttributeMarker`,e[e.duplicateRenderInstruction=1211]=`duplicateRenderInstruction`,e[e.missingElementDefinition=1401]=`missingElementDefinition`,e[e.noRegistrationForContext=1501]=`noRegistrationForContext`,e[e.noFactoryForResolver=1502]=`noFactoryForResolver`,e[e.invalidResolverStrategy=1503]=`invalidResolverStrategy`,e[e.cannotAutoregisterDependency=1504]=`cannotAutoregisterDependency`,e[e.cannotResolveKey=1505]=`cannotResolveKey`,e[e.cannotConstructNativeFunction=1506]=`cannotConstructNativeFunction`,e[e.cannotJITRegisterNonConstructor=1507]=`cannotJITRegisterNonConstructor`,e[e.cannotJITRegisterIntrinsic=1508]=`cannotJITRegisterIntrinsic`,e[e.cannotJITRegisterInterface=1509]=`cannotJITRegisterInterface`,e[e.invalidResolver=1510]=`invalidResolver`,e[e.invalidKey=1511]=`invalidKey`,e[e.noDefaultResolver=1512]=`noDefaultResolver`,e[e.cyclicDependency=1513]=`cyclicDependency`,e[e.connectUpdateRequiresController=1514]=`connectUpdateRequiresController`})(n||={});var r=e=>typeof e==`function`,i=e=>typeof e==`string`,a=()=>void 0,o=Object.create(null),s={warn(e,t){},error(e,t){return Error(`Error ${e}`)},addMessages(e){Object.assign(o,e)}},c=Object.freeze([]);function l(){let e=new Map;return Object.freeze({register(t){return e.has(t.type)?!1:(e.set(t.type,t),!0)},getByType(t){return e.get(t)},getForInstance(t){if(t!=null)return e.get(t.constructor)}})}function u(){let e=new WeakMap;return function(t){let n=e.get(t);if(n===void 0){let r=Reflect.getPrototypeOf(t);for(;n===void 0&&r!==null;)n=e.get(r),r=Reflect.getPrototypeOf(r);n=n===void 0?[]:n.slice(0),e.set(t,n)}return n}}function d(e){e.prototype.toJSON=a}var ee=class extends t{createObserver(){return this}bind(e){return this.evaluate(e.source,e.context)}};d(ee);function te(e,t){return new ee(e,t)}var f=class{constructor(e,t){this.sub1=void 0,this.sub2=void 0,this.spillover=void 0,this.subject=e,this.sub1=t}has(e){return this.spillover===void 0?this.sub1===e||this.sub2===e:this.spillover.indexOf(e)!==-1}subscribe(e){let t=this.spillover;if(t===void 0){if(this.has(e))return;if(this.sub1===void 0){this.sub1=e;return}if(this.sub2===void 0){this.sub2=e;return}this.spillover=[this.sub1,this.sub2,e],this.sub1=void 0,this.sub2=void 0}else t.indexOf(e)===-1&&t.push(e)}unsubscribe(e){let t=this.spillover;if(t===void 0)this.sub1===e?this.sub1=void 0:this.sub2===e&&(this.sub2=void 0);else{let n=t.indexOf(e);n!==-1&&t.splice(n,1)}}notify(e){let t=this.spillover,n=this.subject;if(t===void 0){let t=this.sub1,r=this.sub2;t!==void 0&&t.handleChange(n,e),r!==void 0&&r.handleChange(n,e)}else for(let r=0,i=t.length;r<i;++r)t[r].handleChange(n,e)}},ne=class{constructor(e){this.subscribers={},this.subjectSubscribers=null,this.subject=e}notify(e){var t,n;(t=this.subscribers[e])==null||t.notify(e),(n=this.subjectSubscribers)==null||n.notify(e)}subscribe(e,t){let n;n=t?this.subscribers[t]??(this.subscribers[t]=new f(this.subject)):this.subjectSubscribers??=new f(this.subject),n.subscribe(e)}unsubscribe(e,t){var n,r;t?(n=this.subscribers[t])==null||n.unsubscribe(e):(r=this.subjectSubscribers)==null||r.unsubscribe(e)}},p=[],re=[],ie=globalThis.requestAnimationFrame,ae=!0;function oe(){if(re.length)throw re.shift()}function se(e){try{e.call()}catch(e){if(ae)re.push(e),setTimeout(oe,0);else throw p.length=0,e}}function ce(){let e=0;for(;e<p.length;)if(se(p[e]),e++,e>1024){for(let t=0,n=p.length-e;t<n;t++)p[t]=p[t+e];p.length-=e,e=0}p.length=0}function le(e){p.push(e),p.length<2&&(ae?ie(ce):ce())}var m=Object.freeze({enqueue:le,next:()=>new Promise(le),process:ce,setMode:e=>ae=e}),ue=Object.freeze({unknown:void 0,coupled:1}),h=(()=>{let e=m.enqueue,t=/(:|&&|\|\||if|\?\.)/,a=new WeakMap,o,c=e=>{throw s.error(n.needsArrayObservation)};function l(e){let t=e.$fastController??a.get(e);return t===void 0&&(Array.isArray(e)?t=c(e):a.set(e,t=new ne(e))),t}let ee=u();class te{constructor(e){this.name=e,this.field=`_${e}`,this.callback=`${e}Changed`}getValue(e){return o!==void 0&&o.watch(e,this.name),e[this.field]}setValue(e,t){let n=this.field,i=e[n];if(i!==t){e[n]=t;let a=e[this.callback];r(a)&&a.call(e,i,t),l(e).notify(this.name)}}}class p extends f{constructor(e,t,n=!1){super(e,t),this.expression=e,this.isVolatileBinding=n,this.needsRefresh=!0,this.needsQueue=!0,this.isAsync=!0,this.first=this,this.last=null,this.propertySource=void 0,this.propertyName=void 0,this.notifier=void 0,this.next=void 0}setMode(e){this.isAsync=this.needsQueue=e}bind(e){let t=this.observe(e.source,e.context);return!e.isBound&&this.requiresUnbind(e)&&e.onUnbind(this),t}requiresUnbind(e){return e.sourceLifetime!==ue.coupled||this.first!==this.last||this.first.propertySource!==e.source}unbind(e){this.dispose()}observe(e,t){this.needsRefresh&&this.last!==null&&this.dispose();let n=o;o=this.needsRefresh?this:void 0,this.needsRefresh=this.isVolatileBinding;let r;try{r=this.expression(e,t)}finally{o=n}return r}disconnect(){this.dispose()}dispose(){if(this.last!==null){let e=this.first;for(;e!==void 0;)e.notifier.unsubscribe(this,e.propertyName),e=e.next;this.last=null,this.needsRefresh=this.needsQueue=this.isAsync}}watch(e,t){let n=this.last,r=l(e),i=n===null?this.first:{};if(i.propertySource=e,i.propertyName=t,i.notifier=r,r.subscribe(this,t),n!==null){if(!this.needsRefresh){let t;o=void 0,t=n.propertySource[n.propertyName],o=this,e===t&&(this.needsRefresh=!0)}n.next=i}this.last=i}handleChange(){this.needsQueue?(this.needsQueue=!1,e(this)):this.isAsync||this.call()}call(){this.last!==null&&(this.needsQueue=this.isAsync,this.notify(this))}*records(){let e=this.first;for(;e!==void 0;)yield e,e=e.next}}return d(p),Object.freeze({setArrayObserverFactory(e){c=e},getNotifier:l,track(e,t){o&&o.watch(e,t)},trackVolatile(){o&&(o.needsRefresh=!0)},notify(e,t){l(e).notify(t)},defineProperty(e,t){i(t)&&(t=new te(t)),ee(e).push(t),Reflect.defineProperty(e,t.name,{enumerable:!0,get(){return t.getValue(this)},set(e){t.setValue(this,e)}})},getAccessors:ee,binding(e,t,n=this.isVolatileBinding(e)){return new p(e,t,n)},isVolatileBinding(e){return t.test(e.toString())}})})();function g(e,t){h.defineProperty(e,t)}var de=(()=>{let e=null;return{get(){return e},set(t){e=t}}})(),fe=Object.freeze({default:{index:0,length:0,get event(){return fe.getEvent()},eventDetail(){return this.event.detail},eventTarget(){return this.event.target}},getEvent(){return de.get()},setEvent(e){de.set(e)}}),pe=class extends t{createObserver(e){return h.binding(this.evaluate,e,this.isVolatile)}};function me(e,t,n=h.isVolatileBinding(e)){return new pe(e,t,n)}var _=Object.freeze({none:0,attribute:1,booleanAttribute:2,property:3,content:4,tokenList:5,event:6}),he=e=>e,ge=globalThis.trustedTypes?globalThis.trustedTypes.createPolicy(`fast-element`,{createHTML:he}):{createHTML:he},_e=Object.freeze({createHTML(e){return ge.createHTML(e)},protect(e,t,n,r){return r}}),ve=_e,ye=Object.freeze({get policy(){return _e},setPolicy(e){if(_e!==ve)throw s.error(n.onlySetDOMPolicyOnce);_e=e},setAttribute(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)},setBooleanAttribute(e,t,n){n?e.setAttribute(t,``):e.removeAttribute(t)}}),be=`boolean`,xe=`reflect`,Se=Object.freeze({locate:u()}),Ce={toView(e){return e?``:null},fromView(e){return!!e}};function we(e){if(e==null)return null;let t=e*1;return isNaN(t)?null:t}var Te={toView(e){let t=we(e);return t&&t.toString()},fromView:we},Ee=class e{constructor(e,t,n=t.toLowerCase(),r=xe,i){this.guards=new Set,this.Owner=e,this.name=t,this.attribute=n,this.mode=r,this.converter=i,this.fieldName=`_${t}`,this.callbackName=`${t}Changed`,this.hasCallback=this.callbackName in e.prototype,r===be&&i===void 0&&(this.converter=Ce)}setValue(e,t){let n=e[this.fieldName],r=this.converter;r!==void 0&&(t=r.fromView(t)),n!==t&&(e[this.fieldName]=t,this.tryReflectToAttribute(e),this.hasCallback&&e[this.callbackName](n,t),e.$fastController.notify(this.name))}getValue(e){return h.track(e,this.name),e[this.fieldName]}onAttributeChangedCallback(e,t){this.guards.has(e)||(this.guards.add(e),this.mode===be?this.setValue(e,t!==null):this.setValue(e,t),this.guards.delete(e))}tryReflectToAttribute(e){let t=this.mode,n=this.guards;n.has(e)||t===`fromView`||m.enqueue(()=>{n.add(e);let r=e[this.fieldName];switch(t){case xe:{let t=this.converter;ye.setAttribute(e,this.attribute,t===void 0?r:t.toView(r));break}case be:ye.setBooleanAttribute(e,this.attribute,r);break}n.delete(e)})}static collect(t,...n){let r=[];n.push(Se.locate(t));for(let a=0,o=n.length;a<o;++a){let o=n[a];if(o!==void 0)for(let n=0,a=o.length;n<a;++n){let a=o[n];i(a)?r.push(new e(t,a)):r.push(new e(t,a.property,a.attribute,a.mode,a.converter))}}return r}};function v(e,t){let n;function r(e,t){arguments.length>1&&(n.property=t),Se.locate(e.constructor).push(n)}if(arguments.length>1){n={},r(e,t);return}return n=e===void 0?{}:e,r}var De;function Oe(e){return e.reduce((e,t)=>(t instanceof ke?e.push(...Oe(t.styles)):e.push(t),e),[])}var ke=class e{get strategy(){return this._strategy===null&&(De||e.setDefaultStrategy(e.supportsAdoptedStyleSheets?Ae():Me()),this.withStrategy(De)),this._strategy}constructor(e){this.styles=e,this.targets=new WeakSet,this._strategy=null}addStylesTo(e){this.strategy.addStylesTo(e),this.targets.add(e)}removeStylesFrom(e){this.strategy.removeStylesFrom(e),this.targets.delete(e)}isAttachedTo(e){return this.targets.has(e)}withStrategy(e){return this._strategy=new e(Oe(this.styles)),this}static setDefaultStrategy(e){De=e}static normalize(t){return t===void 0?void 0:Array.isArray(t)?new e(t):t instanceof e?t:new e([t])}};ke.supportsAdoptedStyleSheets=Array.isArray(document.adoptedStyleSheets)&&`replace`in CSSStyleSheet.prototype;function Ae(){let e=new Map;return class{constructor(t){this.sheets=t.map(t=>{if(t instanceof CSSStyleSheet)return t;let n=e.get(t);return n===void 0&&(n=new CSSStyleSheet,n.replaceSync(t),e.set(t,n)),n})}addStylesTo(e){let t=e;t.adoptedStyleSheets=[...t.adoptedStyleSheets,...this.sheets]}removeStylesFrom(e){let t=e;t.adoptedStyleSheets=t.adoptedStyleSheets.filter(e=>this.sheets.indexOf(e)===-1)}}}var je=0;function Me(){return class{constructor(e){this.styles=e,this.styleClass=`fast-${++je}`}addStylesTo(e){let t=e===document?document.body:e;for(let e=0;e<this.styles.length;e++){let n=document.createElement(`style`);n.innerHTML=this.styles[e],n.className=this.styleClass,t.append(n)}}removeStylesFrom(e){let t=e===document?document.body:e,n=t.querySelectorAll(`.${this.styleClass}`);for(let e=0,r=n.length;e<r;++e)t.removeChild(n[e])}}}var Ne={},Pe=new WeakMap,Fe=l(),Ie=Object.freeze({register(e){if(!Fe.register(e))return!1;let t=Le(e.registry);return Object.prototype.hasOwnProperty.call(t,e.name)||h.defineProperty(t,e.name),t[e.name]=e.type,!0},getByType:Fe.getByType,getForInstance:Fe.getForInstance,whenRegistered:ze});function Le(e=customElements){if(e===customElements)return Ne;let t=Pe.get(e);return t||(t={},Pe.set(e,t)),t}function Re(e){return e===void 0?void 0:Ie.getByType(e)}function ze(e,t=customElements){let n=Le(t);Object.prototype.hasOwnProperty.call(n,e)||h.defineProperty(n,e);let r=Re(n[e]);return r===void 0?new Promise(t=>{let r=h.getNotifier(n),i={handleChange:()=>{let a=Re(n[e]);a!==void 0&&(r.unsubscribe(i,e),t(a))}};r.subscribe(i,e)}):Promise.resolve(r)}var Be={mode:`open`},Ve={},He=new Set,Ue=new WeakMap,We=new WeakMap,Ge=new WeakMap,Ke=new WeakMap,qe=new WeakMap;function Je(e){return r(e)}function Ye(e){return typeof e?.then==`function`}function Xe(e,t){if(We.delete(e),e.template===void 0&&t!==void 0&&(e.template=t),e.template!==void 0)return Ge.delete(e),Ue.delete(e),e.template}function Ze(e,t=e.registry,n){if(!n?.length)return;let r=e,i=Ke.get(r);if(!i?.has(t)){i===void 0&&(i=new WeakSet,Ke.set(r,i)),i.add(t);for(let t of n)t(e)}}function Qe(e){return qe.get(e)??null}function $e(e){if(e.template!==void 0)return Ge.delete(e),e.template;let t=We.get(e);if(t)return t;let n=Ue.get(e);if(!n)return;Ge.delete(e);let r;try{r=n(e)}catch(t){throw Ge.set(e,t),t}if(Ye(r)){let t=Promise.resolve(r).then(t=>Xe(e,t)).catch(t=>{throw We.delete(e),Ge.set(e,t),t});return We.set(e,t),t}return Xe(e,r)}function et(e,t){let n=e;if(t===void 0){Ge.delete(n);return}Ge.set(n,t)}var tt=class e{get isDefined(){return this.platformDefined}constructor(e,t=e.definition){this.platformDefined=!1,i(t)&&(t={name:t}),this.type=e,this.name=t.name,this.registry=t.registry??customElements,Je(t.template)?Ue.set(this,t.template):this.template=t.template;let n=e.prototype,r=Ee.collect(e,t.attributes),a=Array(r.length),o={},s={};for(let e=0,t=r.length;e<t;++e){let t=r[e];a[e]=t.attribute,o[t.name]=t,s[t.attribute]=t,h.defineProperty(n,t)}Reflect.defineProperty(e,"observedAttributes",{value:a,enumerable:!0}),this.attributes=r,this.propertyLookup=o,this.attributeLookup=s,this.shadowOptions=t.shadowOptions===void 0?Be:t.shadowOptions===null?void 0:Object.assign(Object.assign({},Be),t.shadowOptions),this.elementOptions=t.elementOptions===void 0?Ve:Object.assign(Object.assign({},Ve),t.elementOptions),this.styles=ke.normalize(t.styles),this.schema=t.schema,Ie.register(this)}define(e=this.registry,t){let n=this.type;if(!e.get(this.name)){if(Ze(this,e,t),this.template===void 0&&Ue.has(this))return Promise.resolve().then(()=>$e(this)).then(t=>{t!==void 0&&!e.get(this.name)&&(this.platformDefined=!0,e.define(this.name,n,this.elementOptions))}).catch(e=>{et(this,e),h.notify(this,`template`)}),this;this.platformDefined=!0,e.define(this.name,n,this.elementOptions)}return this}static compose(t,n){let r=He.has(t)||Ie.getByType(t)?new e(class extends t{},n):new e(t,n);return Promise.resolve(r)}static registerBaseType(e){He.add(e)}};tt.getByType=Ie.getByType,tt.getForInstance=Ie.getForInstance,h.defineProperty(tt.prototype,`template`);var nt={bubbles:!0,composed:!0,cancelable:!0},rt=`isConnected`,it=new WeakMap,at=Symbol(`fast-late-attribute-observer`);function ot(e){return e.shadowRoot??it.get(e)??null}var st,y;(function(e){e[e.connecting=0]=`connecting`,e[e.connected=1]=`connected`,e[e.disconnecting=2]=`disconnecting`,e[e.disconnected=3]=`disconnected`})(y||={});var ct=class e{get isConnected(){return h.track(this,rt),this.stage===y.connected}get context(){return this.view?.context??fe.default}get isBound(){return this.view?.isBound??!1}get sourceLifetime(){return this.view?.sourceLifetime}get template(){if(this._template===null){let e=this.definition;this.source.resolveTemplate?this._template=this.source.resolveTemplate():e.template&&(this._template=e.template??null)}return this._template}set template(e){this._template!==e&&(this._template=e,this.needsInitialization||this.renderTemplate(e))}get shadowOptions(){return this._shadowRootOptions}set shadowOptions(e){if(this._shadowRootOptions===void 0&&e!==void 0){this._shadowRootOptions=e;let t=this.source.shadowRoot;t?this.hasExistingShadowRoot=!0:(t=this.source.attachShadow(e),e.mode===`closed`&&it.set(this.source,t))}}get mainStyles(){if(this._mainStyles===null){let e=this.definition;this.source.resolveStyles?this._mainStyles=this.source.resolveStyles():e.styles&&(this._mainStyles=e.styles??null)}return this._mainStyles}set mainStyles(e){this._mainStyles!==e&&(this._mainStyles!==null&&this.removeStyles(this._mainStyles),this._mainStyles=e,this.needsInitialization||this.addStyles(e))}constructor(e,t){this.boundObservables=null,this.needsInitialization=!0,this.hasExistingShadowRoot=!1,this.isPrerendered=new Promise(e=>{this._resolvePrerendered=e}),this.isHydrated=new Promise(e=>{this._resolveHydrated=e}),this._template=null,this.stage=y.disconnected,this.guardBehaviorConnection=!1,this.behaviors=null,this.behaviorsConnected=!1,this._mainStyles=null,this.$fastController=this,this.view=null,this._notifier=new ne(e),this.source=e,this.definition=t,this.shadowOptions=t.shadowOptions;let n=Reflect.getPrototypeOf(e),r=n===null?[]:h.getAccessors(n);if(r.length>0){let t=this.boundObservables=Object.create(null);for(let n=0,i=r.length;n<i;++n){let i=r[n].name,a=e[i];a!==void 0&&(delete e[i],t[i]=a)}Object.keys(t).length===0&&(this.boundObservables=null)}this.captureBoundObservables()}get subject(){return this._notifier.subject}notify(e){this._notifier.notify(e)}subscribe(e,t){this._notifier.subscribe(e,t)}unsubscribe(e,t){this._notifier.unsubscribe(e,t)}onUnbind(e){var t;(t=this.view)==null||t.onUnbind(e)}addBehavior(e){let t=this.behaviors??=new Map,n=t.get(e)??0;n===0?(t.set(e,1),e.addedCallback&&e.addedCallback(this),e.connectedCallback&&!this.guardBehaviorConnection&&(this.stage===y.connected||this.stage===y.connecting)&&e.connectedCallback(this)):t.set(e,n+1)}removeBehavior(e,t=!1){let n=this.behaviors;if(n===null)return;let r=n.get(e);r!==void 0&&(r===1||t?(n.delete(e),e.disconnectedCallback&&this.stage!==y.disconnected&&e.disconnectedCallback(this),e.removedCallback&&e.removedCallback(this)):n.set(e,r-1))}addStyles(e){if(!e)return;let t=this.source;e instanceof HTMLElement?(ot(t)??this.source).append(e):e.isAttachedTo(t)||e.addStylesTo(t)}removeStyles(e){if(!e)return;let t=this.source;e instanceof HTMLElement?(ot(t)??t).removeChild(e):e.isAttachedTo(t)&&e.removeStylesFrom(t)}connect(){this.stage===y.disconnected&&(this.stage=y.connecting,this.captureBoundObservables(),this.syncLateAttributes(),this.observeLateAttributes(),this.bindObservables(),this.connectBehaviors(),this.needsInitialization?(this.renderTemplate(this.template),this.addStyles(this.mainStyles),this.needsInitialization=!1):this.view!==null&&this.view.bind(this.source),this.stage=y.connected,h.notify(this,rt))}bindObservables(){if(this.boundObservables!==null){let e=this.source,t=this.boundObservables,n=Object.keys(t);for(let r=0,i=n.length;r<i;++r){let i=n[r];e[i]=t[i]}this.boundObservables=null}}captureBoundObservables(){let e=this.source,t=Object.getOwnPropertyNames(e),n=t=>{let n=Reflect.getPrototypeOf(e);for(;n!==null;){let e=Reflect.getOwnPropertyDescriptor(n,t);if(e?.get||e?.set)return!0;n=Reflect.getPrototypeOf(n)}return!1},r=this.boundObservables;for(let i=0,a=t.length;i<a;++i){let a=t[i],o=a[0]===`_`?a.slice(1):a;if(!n(o))continue;let s=e[o],c=a!==o,l=typeof s==`object`&&!!s&&!s?.$isProxy&&!(Array.isArray(s)&&s?.$fastController);if(s===void 0){c||delete e[a];continue}c&&!l||(delete e[a],(r??=this.boundObservables=Object.create(null))[o]=s)}}syncLateAttributes(){let e=Qe(this.definition);if(e!==null)for(let t of Object.keys(e))this.source.hasAttribute(t)&&this.onAttributeChangedCallback(t,null,this.source.getAttribute(t))}observeLateAttributes(){let e=Qe(this.definition);if(e===null)return;let t=this.source;t[at]===void 0&&(t[at]=new MutationObserver(e=>{let n=t.$fastController,r=Qe(n.definition);if(r!==null)for(let i=0,a=e.length;i<a;++i){let a=e[i].attributeName;a!==null&&r[a]!==void 0&&n.onAttributeChangedCallback(a,null,t.getAttribute(a))}}),t[at].observe(t,{attributes:!0,attributeFilter:Object.keys(e)}))}connectBehaviors(){if(this.behaviorsConnected===!1){let e=this.behaviors;if(e!==null){this.guardBehaviorConnection=!0;for(let t of e.keys())t.connectedCallback&&t.connectedCallback(this);this.guardBehaviorConnection=!1}this.behaviorsConnected=!0}}disconnectBehaviors(){if(this.behaviorsConnected===!0){let e=this.behaviors;if(e!==null)for(let t of e.keys())t.disconnectedCallback&&t.disconnectedCallback(this);this.behaviorsConnected=!1}}disconnect(){this.stage===y.connected&&(this.stage=y.disconnecting,h.notify(this,rt),this.view!==null&&this.view.unbind(),this.disconnectBehaviors(),this.stage=y.disconnected)}onAttributeChangedCallback(e,t,n){let r=this.definition.attributeLookup[e];r!==void 0&&r.onAttributeChangedCallback(this.source,n)}emit(e,t,n){return this.stage===y.connected&&this.source.dispatchEvent(new CustomEvent(e,Object.assign(Object.assign({detail:t},nt),n)))}renderTemplate(t){let n=this.source,r=ot(n)??n;if(this.view!==null)this.view.dispose(),this.view=null;else if((!this.needsInitialization||this.hasExistingShadowRoot)&&(!this.hasExistingShadowRoot||!this.needsInitialization))for(let e=r.firstChild;e!==null;e=r.firstChild)r.removeChild(e);if(t){let i=this.hasExistingShadowRoot&&this.needsInitialization,a=!1;i&&e.hydrationHook&&(a=e.hydrationHook(this,t,n,r)),a||this.renderClientSide(t,n,r),this._resolvePrerendered(i),this._resolveHydrated(a)}else this.needsInitialization&&(this._resolvePrerendered(!1),this._resolveHydrated(!1))}renderClientSide(e,t,n){if(this.hasExistingShadowRoot){for(let e=n.firstChild;e!==null;e=n.firstChild)n.removeChild(e);this.hasExistingShadowRoot=!1}this.view=e.render(t,n,t),this.view.sourceLifetime=ue.coupled}static forCustomElement(t,r=!1){let i=t.$fastController;if(i!==void 0&&!r)return i;let a=tt.getForInstance(t);if(a===void 0)throw s.error(n.missingElementDefinition);return h.getNotifier(a).subscribe({handleChange:()=>{e.forCustomElement(t,!0),t.$fastController.connect()}},`template`),h.getNotifier(a).subscribe({handleChange:()=>{e.forCustomElement(t,!0),t.$fastController.connect()}},`shadowOptions`),t.$fastController=new st(t,a)}static setStrategy(e){st=e}static installHydrationHook(t){e.hydrationHook=t}};ct.hydrationHook=null,d(ct),ct.setStrategy(ct);function lt(e){return`adoptedStyleSheets`in e?e:ot(e)??e.getRootNode()}var ut=class e{constructor(t){let n=e.styleSheetCache;this.sheets=t.map(e=>{if(e instanceof CSSStyleSheet)return e;let t=n.get(e);return t===void 0&&(t=new CSSStyleSheet,t.replaceSync(e),n.set(e,t)),t})}addStylesTo(e){ht(lt(e),this.sheets)}removeStylesFrom(e){gt(lt(e),this.sheets)}};ut.styleSheetCache=new Map;var dt=0,ft=()=>`fast-${++dt}`;function pt(e){return e===document?document.body:e}var mt=class{constructor(e){this.styles=e,this.styleClass=ft()}addStylesTo(e){e=pt(lt(e));let t=this.styles,n=this.styleClass;for(let r=0;r<t.length;r++){let i=document.createElement(`style`);i.innerHTML=t[r],i.className=n,e.append(i)}}removeStylesFrom(e){e=pt(lt(e));let t=e.querySelectorAll(`.${this.styleClass}`);for(let n=0,r=t.length;n<r;++n)e.removeChild(t[n])}},ht=(e,t)=>{e.adoptedStyleSheets=[...e.adoptedStyleSheets,...t]},gt=(e,t)=>{e.adoptedStyleSheets=e.adoptedStyleSheets.filter(e=>t.indexOf(e)===-1)};if(ke.supportsAdoptedStyleSheets){try{document.adoptedStyleSheets.push(),document.adoptedStyleSheets.splice(),ht=(e,t)=>{e.adoptedStyleSheets.push(...t)},gt=(e,t)=>{for(let n of t){let t=e.adoptedStyleSheets.indexOf(n);t!==-1&&e.adoptedStyleSheets.splice(t,1)}}}catch{}ke.setDefaultStrategy(ut)}else ke.setDefaultStrategy(mt);function _t(e){let t=class extends e{constructor(){super(),ct.forCustomElement(this)}$emit(e,t,n){return this.$fastController.emit(e,t,n)}connectedCallback(){this.$fastController.connect()}disconnectedCallback(){this.$fastController.disconnect()}attributeChangedCallback(e,t,n){this.$fastController.onAttributeChangedCallback(e,t,n)}};return tt.registerBaseType(t),t}function vt(e){return typeof e?.then==`function`}function yt(e,t,n){return Array.isArray(t)&&(n=t,t=void 0),(r(e)?tt.compose(e,t):tt.compose(this,e)).then(e=>{Ze(e,e.registry,n);let t=$e(e);return vt(t)?t.then(()=>e.define().type):e.define().type})}function bt(e){return _t(e)}var b=Object.assign(_t(HTMLElement),{from:bt,define:yt});function x(e,t,n){return Object.assign({},n,{get(){return h.trackVolatile(),n.get.apply(this)}})}var xt=l(),St=Object.freeze({getForInstance:xt.getForInstance,getByType:xt.getByType,define(e){return xt.register({type:e}),e}});function Ct(e,t){let n=[],r=``;for(let i=0,a=e.length-1;i<a;++i){r+=e[i];let a=t[i];St.getForInstance(a)!==void 0&&(a=a.createCSS()),a instanceof ke||a instanceof CSSStyleSheet?(r.trim()!==``&&(n.push(r),r=``),n.push(a)):r+=a}return r+=e[e.length-1],r.trim()!==``&&n.push(r),n}var S=((e,...t)=>new ke(Ct(e,t))),wt=class{constructor(e){this.value=e.length===0?``:e.length===1?e[0]:new ke(e)}createCSS(){return this.value}};St.define(wt),S.partial=(e,...t)=>new wt(Ct(e,t));var Tt=`fast-${Math.random().toString(36).substring(2,8)}`,Et=`${Tt}{`,Dt=`}${Tt}`,Ot=Dt.length,kt=0,At=()=>`${Tt}-${++kt}`,jt=Object.freeze({interpolation:e=>`${Et}${e}${Dt}`,attribute:e=>`${At()}="${Et}${e}${Dt}"`,comment:e=>`<!--${Et}${e}${Dt}-->`}),Mt=Object.freeze({parse(e,t){let n=e.split(Et);if(n.length===1)return null;let r=[];for(let e=0,i=n.length;e<i;++e){let i=n[e],a=i.indexOf(Dt),o;if(a===-1)o=i;else{let e=i.substring(0,a);r.push(t[e]),o=i.substring(a+Ot)}o!==``&&r.push(o)}return r}}),Nt=l(),C=Object.freeze({getForInstance:Nt.getForInstance,getByType:Nt.getByType,define(e,t){return t||={},t.type=e,Nt.register(t),e},assignAspect(e,t){if(!t){e.aspectType=_.content;return}switch(e.sourceAspect=t,t[0]){case`:`:e.targetAspect=t.substring(1),e.aspectType=e.targetAspect===`classList`?_.tokenList:_.property;break;case`?`:e.targetAspect=t.substring(1),e.aspectType=_.booleanAttribute;break;case`@`:e.targetAspect=t.substring(1),e.aspectType=_.event;break;default:e.targetAspect=t,e.aspectType=_.attribute;break}}}),Pt=class{constructor(e){this.options=e}createHTML(e){return jt.attribute(e(this))}createBehavior(){return this}};d(Pt);var Ft=class extends Pt{get id(){return this._id}set id(e){this._id=e,this._controllerProperty=`${e}-c`}bind(e){let t=e.targets[this.targetNodeId];t[this._controllerProperty]=e,this.updateTarget(e.source,this.computeNodes(t)),this.observe(t),e.onUnbind(this)}unbind(e){let t=e.targets[this.targetNodeId];this.updateTarget(e.source,c),this.disconnect(t),t[this._controllerProperty]=null}getSource(e){return e[this._controllerProperty].source}updateTarget(e,t){e[this.options.property]=t}computeNodes(e){let t=this.getNodes(e);return`filter`in this.options&&(t=t.filter(this.options.filter)),t}},It=/fe-b\$\$start\$\$(\d+)\$\$(.+)\$\$fe-b/,Lt=/fe-b\$\$end\$\$(\d+)\$\$(.+)\$\$fe-b/,Rt=/fe-repeat\$\$start\$\$(\d+)\$\$fe-repeat/,zt=/fe-repeat\$\$end\$\$(\d+)\$\$fe-repeat/,Bt=/^(?:.{0,1000})fe-eb\$\$start\$\$(.+?)\$\$fe-eb/,Vt=/fe-eb\$\$end\$\$(.{0,1000})\$\$fe-eb(?:.{0,1000})$/;function Ht(e){return e&&e.nodeType===Node.COMMENT_NODE}var w=Object.freeze({attributeMarkerName:`data-fe`,legacyAttributeMarkerName:`data-fe-b`,legacyCompactAttributeMarkerName:`data-fe-c`,contentBindingStartMarker(){return`fe:b`},contentBindingEndMarker(){return`fe:/b`},repeatStartMarker(){return`fe:r`},repeatEndMarker(){return`fe:/r`},elementBoundaryStartMarker(){return`fe:e`},elementBoundaryEndMarker(){return`fe:/e`},isContentBindingStartMarker(e){return e===`fe:b`||It.test(e)},isContentBindingEndMarker(e){return e===`fe:/b`||Lt.test(e)},isRepeatViewStartMarker(e){return e===`fe:r`||Rt.test(e)},isRepeatViewEndMarker(e){return e===`fe:/r`||zt.test(e)},isElementBoundaryStartMarker(e){return Ht(e)&&(e.data===`fe:e`||Bt.test(e.data))},isElementBoundaryEndMarker(e){return Ht(e)&&(e.data===`fe:/e`||Vt.test(e.data))},parseAttributeBindingCount(e){let t=e.getAttribute(this.attributeMarkerName);if(t===null)return null;let r=t.trim();if(!/^\d+$/.test(r))throw s.error(n.invalidHydrationAttributeMarker,{value:t});let i=parseInt(r,10);if(i<1)throw s.error(n.invalidHydrationAttributeMarker,{value:t});return i},parseLegacyAttributeBindingIndices(e){let t=[],r=e.getAttribute(this.legacyAttributeMarkerName);if(r!==null)for(let e of r.trim().split(/\s+/)){if(e===``)continue;let i=Number(e);if(!Number.isInteger(i)||i<0)throw s.error(n.invalidHydrationAttributeMarker,{value:r});t.push(i)}let i=`${this.legacyAttributeMarkerName}-`,a=`${this.legacyCompactAttributeMarkerName}-`;for(let r of e.getAttributeNames())if(r.startsWith(i)){let e=Number(r.slice(i.length));if(!Number.isInteger(e)||e<0)throw s.error(n.invalidHydrationAttributeMarker,{value:r});t.push(e)}else if(r.startsWith(a)){let[e,i]=r.slice(a.length).split(`-`).map(e=>Number(e));if(!Number.isInteger(e)||!Number.isInteger(i)||e<0||i<1)throw s.error(n.invalidHydrationAttributeMarker,{value:r});for(let n=0;n<i;n++)t.push(e+n)}return t.length===0?null:t},removeLegacyAttributeBindingMarkers(e){e.removeAttribute(this.legacyAttributeMarkerName);for(let t of e.getAttributeNames())(t.startsWith(`${this.legacyAttributeMarkerName}-`)||t.startsWith(`${this.legacyCompactAttributeMarkerName}-`))&&e.removeAttribute(t)},parseLegacyContentBindingStartIndex(e){return Ut(It,e)}});function Ut(e,t){let n=e.exec(t);return n===null?null:Number(n[1])}var Wt=Symbol.for(`fe-hydration`);function Gt(e){return e[Wt]===Wt}var Kt=`unknown`;function qt(e,t){return`Hydration mismatch in <${e}>${t?`: ${t}`:``}. Install hydrationDebugger() from "@microsoft/fast-element/hydration.js" and pass it as enableHydration({ debugger: hydrationDebugger() }) for an "Expected / Received" report including the SSR HTML snippet.`}var Jt="content following `<!--fe:b-->` content binding marker",Yt="matching `<!--fe:/b-->` content binding close marker",Xt="matching `<!--fe:/e-->` element boundary close marker";function Zt(e){return`no more attribute bindings (template defines ${e})`}function Qt(e){return`no more content bindings (template defines ${e})`}function $t(e,t){return qt((e??Kt).toLowerCase(),t)}var en={formatBindingMismatch(e,t,n,r){return{message:$t(r,void 0)}},formatStructuralError(e,t,n){return{message:$t(t,n)}}};function tn(){return en}function nn(e){if(e)return e.getRootNode().host?.nodeName}var rn=class extends Error{constructor(e,t,n,r,i){super(e),this.factories=t,this.node=n,this.expected=r,this.received=i}};function an(e){return e.nodeType===Node.COMMENT_NODE}function on(e){return e.nodeType===Node.TEXT_NODE}function sn(e,t){let n=document.createRange();return n.setStart(e,0),n.setEnd(t,an(t)||on(t)?t.data.length:t.childNodes.length),n}function cn(e,t,n){let r=sn(e,t),i=r.commonAncestorContainer,a=document.createTreeWalker(i,NodeFilter.SHOW_ELEMENT+NodeFilter.SHOW_COMMENT+NodeFilter.SHOW_TEXT,{acceptNode(e){return r.comparePoint(e,0)===0?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}}),o={},s={},c=dn(n),l=c,u=a.currentNode=e;for(;u!==null;){switch(u.nodeType){case Node.ELEMENT_NODE:{let e=u,t=w.parseLegacyAttributeBindingIndices(e);if(t!==null){for(let r of t){let t=r+c,i=n[t];if(!i){let t=Zt(n.length),r=tn().formatStructuralError(u,nn(u),t);throw new rn(r.message,n,e,r.expected,r.received)}fn(i,u,o),l=Math.max(l,t+1)}w.removeLegacyAttributeBindingMarkers(e);break}let r=w.parseAttributeBindingCount(e);if(r!==null){for(let e=0;e<r;e++){let e=n[l++];if(!e){let e=Zt(n.length),t=tn().formatStructuralError(u,nn(u),e);throw new rn(t.message,n,u,t.expected,t.received)}fn(e,u,o)}e.removeAttribute(w.attributeMarkerName)}break}case Node.COMMENT_NODE:{let e=u.data;if(w.isElementBoundaryStartMarker(u))u.data=``,un(a,n,u);else if(w.isContentBindingStartMarker(e)){let t=w.parseLegacyContentBindingStartIndex(e),r=t===null?l++:t+c,i=n[r];if(l=Math.max(l,r+1),!i){let e=Qt(n.length),t=tn().formatStructuralError(u,nn(u),e);throw new rn(t.message,n,u,t.expected,t.received)}ln(u,a,i,n,o,s)}break}}u=a.nextNode()}return r.detach(),{targets:o,boundaries:s}}function ln(e,t,n,r,i,a){let o=[],s=t.nextSibling();if(e.data=``,s===null){let t=Jt,n=tn().formatStructuralError(e,nn(e),t);throw new rn(n.message,r,e,n.expected,n.received)}let c=s,l=0;for(;s!==null;){if(an(s)){if(w.isContentBindingStartMarker(s.data))l++;else if(w.isContentBindingEndMarker(s.data)){if(l===0)break;l--}}o.push(s),s=t.nextSibling()}if(s===null){let t=Yt,n=tn().formatStructuralError(e,nn(e),t);throw new rn(n.message,r,e,n.expected,n.received)}s.data=``,o.length===1&&on(o[0])?fn(n,o[0],i):(s!==c&&s.previousSibling!==null&&(a[n.targetNodeId]={first:c,last:s.previousSibling}),fn(n,s.parentNode.insertBefore(document.createTextNode(``),s),i))}function un(e,t,n){let r=0,i=e.nextSibling();for(;i!==null;){if(an(i)){if(w.isElementBoundaryStartMarker(i))i.data=``,r++;else if(w.isElementBoundaryEndMarker(i)){if(r===0){i.data=``;return}i.data=``,r--}}i=e.nextSibling()}let a=Xt,o=tn().formatStructuralError(n,nn(n),a);throw new rn(o.message,t,n,o.expected,o.received)}function dn(e){let t=0;for(let n=0,r=e.length;n<r&&e[n].targetNodeId===`h`;++n)t++;return t}function fn(e,t,n){if(e.targetNodeId===void 0)throw Error(`Factory could not be target to the node`);n[e.targetNodeId]=t}function pn(e,t){let n=e.parentNode,r=e,i;for(;r!==t;){if(i=r.nextSibling,!i)throw Error(`Unmatched first/last child inside "${t.getRootNode().host.nodeName}".`);n.removeChild(r),r=i}n.removeChild(t)}var mn=class{constructor(){this.index=0,this.length=0}get event(){return fe.getEvent()}get isEven(){return this.index%2==0}get isOdd(){return this.index%2!=0}get isFirst(){return this.index===0}get isInMiddle(){return!this.isFirst&&!this.isLast}get isLast(){return this.index===this.length-1}eventDetail(){return this.event.detail}eventTarget(){return this.event.target}},hn=class extends mn{constructor(e,t,n){super(),this.fragment=e,this.factories=t,this.targets=n,this.behaviors=null,this.unbindables=[],this.source=null,this.isBound=!1,this.sourceLifetime=ue.unknown,this._skipAttrUpdates=!1,this.isPrerendered=Promise.resolve(!1),this.isHydrated=Promise.resolve(!1),this.context=this,this.firstChild=e.firstChild,this.lastChild=e.lastChild}appendTo(e){e.appendChild(this.fragment)}insertBefore(e){if(this.fragment.hasChildNodes())e.parentNode.insertBefore(this.fragment,e);else{let t=this.lastChild;if(e.previousSibling===t)return;let n=e.parentNode,r=this.firstChild,i;for(;r!==t;)i=r.nextSibling,n.insertBefore(r,e),r=i;n.insertBefore(t,e)}}remove(){let e=this.fragment,t=this.lastChild,n=this.firstChild,r;for(;n!==t;)r=n.nextSibling,e.appendChild(n),n=r;e.appendChild(t)}dispose(){pn(this.firstChild,this.lastChild),this.unbind()}onUnbind(e){this.unbindables.push(e)}bind(e,t=this){if(this.source===e&&this.context===t)return;let n=this.behaviors;if(n===null){this.source=e,this.context=t,this.behaviors=n=Array(this.factories.length);let r=this.factories;for(let e=0,t=r.length;e<t;++e){let t=r[e].createBehavior();t.bind(this),n[e]=t}}else{this.source!==null&&this.evaluateUnbindables(),this.isBound=!1,this.source=e,this.context=t;for(let e=0,t=n.length;e<t;++e)n[e].bind(this)}this.isBound=!0}unbind(){!this.isBound||this.source===null||(this.evaluateUnbindables(),this.source=null,this.context=this,this.isBound=!1)}evaluateUnbindables(){let e=this.unbindables;for(let t=0,n=e.length;t<n;++t)e[t].unbind(this);e.length=0}static disposeContiguousBatch(e){if(e.length!==0){pn(e[0].firstChild,e[e.length-1].lastChild);for(let t=0,n=e.length;t<n;++t)e[t].unbind()}}};d(hn),h.defineProperty(hn.prototype,`index`),h.defineProperty(hn.prototype,`length`);var gn,_n={unhydrated:`unhydrated`,hydrating:`hydrating`,hydrated:`hydrated`},vn=class extends Error{constructor(e,t,n,r,i,a){super(e),this.factory=t,this.fragment=n,this.templateString=r,this.expected=i,this.received=a}},yn=class extends mn{get hydrationStage(){return this._hydrationStage}get targets(){return this._targets}get bindingViewBoundaries(){return this._bindingViewBoundaries}constructor(e,t,n,r){super(),this.firstChild=e,this.lastChild=t,this.sourceTemplate=n,this.hostBindingTarget=r,this[gn]=Wt,this.context=this,this.source=null,this.isBound=!1,this.sourceLifetime=ue.unknown,this.unbindables=[],this.fragment=null,this.behaviors=null,this._hydrationStage=_n.unhydrated,this._bindingViewBoundaries={},this._targets={},this.factories=n.compile().factories}insertBefore(e){if(this.fragment!==null)if(this.fragment.hasChildNodes())e.parentNode.insertBefore(this.fragment,e);else{let t=this.lastChild;if(e.previousSibling===t)return;let n=e.parentNode,r=this.firstChild,i;for(;r!==t;)i=r.nextSibling,n.insertBefore(r,e),r=i;n.insertBefore(t,e)}}appendTo(e){this.fragment!==null&&e.appendChild(this.fragment)}remove(){let e=this.fragment||=document.createDocumentFragment(),t=this.lastChild,n=this.firstChild,r;for(;n!==t;){if(r=n.nextSibling,!r)throw Error(`Unmatched first/last child inside "${t.getRootNode().host.nodeName}".`);e.appendChild(n),n=r}e.appendChild(t)}bind(e,t=this){if(this.source===e&&this.context===t)return;this.hydrationStage!==_n.hydrated&&(this._hydrationStage=_n.hydrating);let n=this.behaviors;if(n===null){this.source=e,this.context=t;try{let{targets:e,boundaries:t}=cn(this.firstChild,this.lastChild,this.factories);this._targets=e,this._bindingViewBoundaries=t}catch(e){if(e instanceof rn){let t=this.sourceTemplate.html;typeof t!=`string`&&(t=t.innerHTML),e.templateString=t}throw e}this.behaviors=n=Array(this.factories.length);let r=this.factories;for(let e=0,t=r.length;e<t;++e){let t=r[e];if(t.targetNodeId===`h`&&this.hostBindingTarget&&fn(t,this.hostBindingTarget,this._targets),t.targetNodeId in this.targets){let r=t.createBehavior();r.bind(this),n[e]=r}else{let e=this.sourceTemplate.html;typeof e!=`string`&&(e=e.innerHTML);let n=sn(this.firstChild,this.lastChild).cloneContents(),r=tn().formatBindingMismatch(t,this.firstChild,this.lastChild,nn(this.firstChild));throw new vn(r.message,t,n,e,r.expected,r.received)}}}else{this.source!==null&&this.evaluateUnbindables(),this.isBound=!1,this.source=e,this.context=t;for(let e=0,t=n.length;e<t;++e)n[e].bind(this)}this.isBound=!0,this._hydrationStage=_n.hydrated}unbind(){!this.isBound||this.source===null||(this.evaluateUnbindables(),this.source=null,this.context=this,this.isBound=!1)}dispose(){pn(this.firstChild,this.lastChild),this.unbind()}onUnbind(e){this.unbindables.push(e)}evaluateUnbindables(){let e=this.unbindables;for(let t=0,n=e.length;t<n;++t)e[t].unbind(this);e.length=0}};gn=Wt,d(yn);function bn(e){return e.create!==void 0}function xn(e,t,n,r){if(n??=``,bn(n)){e.textContent=``;let t=e.$fastView;if(t===void 0)if(Gt(r)&&Gt(n)&&r.bindingViewBoundaries[this.targetNodeId]!==void 0&&r.hydrationStage!==_n.hydrated){let e=r.bindingViewBoundaries[this.targetNodeId];t=n.hydrate(e.first,e.last)}else t=n.create();else e.$fastTemplate!==n&&(t.isComposed&&(t.remove(),t.unbind()),t=n.create());t.isComposed?t.needsBindOnly&&(t.needsBindOnly=!1,t.bind(r.source,r.context)):(t.isComposed=!0,t.bind(r.source,r.context),t.insertBefore(e),e.$fastView=t,e.$fastTemplate=n)}else{let t=e.$fastView;t!==void 0&&t.isComposed&&(t.isComposed=!1,t.remove(),t.needsBindOnly?t.needsBindOnly=!1:t.unbind()),e.textContent=n}}function Sn(e,t,n){let r=`${this.id}-t`,i=e[r]??(e[r]={v:0,cv:Object.create(null)}),a=i.cv,o=i.v,s=e[t];if(n!=null&&n.length){let e=n.split(/\s+/);for(let t=0,n=e.length;t<n;++t){let n=e[t];n!==``&&(a[n]=o,s.add(n))}}if(i.v=o+1,o!==0){--o;for(let e in a)a[e]===o&&s.remove(e)}}var Cn={[_.attribute]:ye.setAttribute,[_.booleanAttribute]:ye.setBooleanAttribute,[_.property]:(e,t,n)=>e[t]=n,[_.content]:xn,[_.tokenList]:Sn,[_.event]:()=>void 0},wn=class{constructor(e){this.updateTarget=null,this.aspectType=_.content,this.dataBinding=e}createHTML(e){return jt.interpolation(e(this))}createBehavior(){if(this.updateTarget===null){let e=Cn[this.aspectType],t=this.dataBinding.policy??this.policy;if(!e)throw s.error(n.unsupportedBindingBehavior);this.data=`${this.id}-d`,this.updateTarget=t.protect(this.targetTagName,this.aspectType,this.targetAspect,e)}return this}bind(e){let t=e.targets[this.targetNodeId];switch(this.aspectType){case _.event:t[this.data]=e,t.addEventListener(this.targetAspect,this,this.dataBinding.options);break;case _.content:e.onUnbind(this);default:{let n=t[this.data]??(t[this.data]=this.dataBinding.createObserver(this,this));n.target=t,n.controller=e;let r=n.bind(e);if(e._skipAttrUpdates&&(this.aspectType===_.attribute||this.aspectType===_.booleanAttribute))break;this.updateTarget(t,this.targetAspect,r,e);break}}}unbind(e){let t=e.targets[this.targetNodeId].$fastView;t!==void 0&&t.isComposed&&(t.unbind(),t.needsBindOnly=!0)}handleEvent(e){let t=e.currentTarget[this.data];if(t.isBound){fe.setEvent(e);let n=this.dataBinding.evaluate(t.source,t.context);fe.setEvent(null),n!==!0&&e.preventDefault()}}handleChange(e,t){let n=t.controller;if(!n.isBound)return;let r=t.target;this.updateTarget(r,this.targetAspect,t.bind(n),n)}};C.define(wn,{aspected:!0});var Tn=(e,t)=>`${e}.${t}`,En={},T={index:0,node:null};function Dn(e){e.startsWith(`fast-`)||s.warn(n.hostBindingWithoutHost,{name:e})}var On=new Proxy(document.createElement(`div`),{get(e,t){Dn(t);let n=Reflect.get(e,t);return r(n)?n.bind(e):n},set(e,t,n){return Dn(t),Reflect.set(e,t,n)}}),kn=class{constructor(e,t,n){this.fragment=e,this.directives=t,this.policy=n,this.proto=null,this.nodeIds=new Set,this.descriptors={},this.factories=[]}addFactory(e,t,n,r,i){this.nodeIds.has(n)||(this.nodeIds.add(n),this.addTargetDescriptor(t,n,r)),e.id=e.id??At(),e.targetNodeId=n,e.targetTagName=i,e.policy=e.policy??this.policy,this.factories.push(e)}freeze(){return this.proto=Object.create(null,this.descriptors),this}addTargetDescriptor(e,t,n){let r=this.descriptors;if(t===`r`||t===`h`||r[t])return;if(!r[e]){let t=e.lastIndexOf(`.`),n=e.substring(0,t),r=parseInt(e.substring(t+1),10);this.addTargetDescriptor(n,e,r)}let i=En[t];if(!i){let r=`_${t}`;En[t]=i={get(){return this[r]??(this[r]=this[e].childNodes[n])}}}r[t]=i}createView(e){let t=this.fragment.cloneNode(!0),n=Object.create(this.proto);n.r=t,n.h=e??On;for(let e of this.nodeIds)Reflect.get(n,e);return new hn(t,this.factories,n)}};function An(e,t,n,r,i,a=!1){let o=n.attributes,s=e.directives;for(let c=0,l=o.length;c<l;++c){let u=o[c],d=u.value,ee=Mt.parse(d,s),f=null;ee===null?a&&(f=new wn(te(()=>d,e.policy)),C.assignAspect(f,u.name)):f=In.aggregate(ee,e.policy),f!==null&&(n.removeAttributeNode(u),c--,l--,e.addFactory(f,t,r,i,n.tagName))}}function jn(e,t,n,r,a){let o=Mt.parse(t.textContent,e.directives);if(o===null)return T.node=t.nextSibling,T.index=a+1,T;let s,c=s=t;for(let t=0,l=o.length;t<l;++t){let l=o[t];t!==0&&(a++,r=Tn(n,a),s=c.parentNode.insertBefore(document.createTextNode(``),c.nextSibling)),i(l)?s.textContent=l:(s.textContent=` `,C.assignAspect(l),e.addFactory(l,n,r,a,null)),c=s}return T.index=a+1,T.node=c.nextSibling,T}function Mn(e,t,n){let r=0,i=t.firstChild;for(;i;){let t=Nn(e,n,i,r);i=t.node,r=t.index}}function Nn(e,t,n,r){let i=Tn(t,r);switch(n.nodeType){case 1:An(e,t,n,i,r),Mn(e,n,i);break;case 3:return jn(e,n,t,i,r);case 8:{let a=Mt.parse(n.data,e.directives);a!==null&&e.addFactory(In.aggregate(a),t,i,r,null);break}}return T.index=r+1,T.node=n.nextSibling,T}function Pn(e,t){return e&&e.nodeType===8&&Mt.parse(e.data,t)!==null}var Fn=`TEMPLATE`,In={compile(e,t,n=ye.policy){let r;if(i(e)){r=document.createElement(Fn),r.innerHTML=n.createHTML(e);let t=r.content.firstElementChild;t!==null&&t.tagName===Fn&&(r=t)}else r=e;!r.content.firstChild&&!r.content.lastChild&&r.content.appendChild(document.createComment(``));let a=document.adoptNode(r.content),o=new kn(a,t,n);return An(o,``,r,`h`,0,!0),(Pn(a.firstChild,t)||a.childNodes.length===1&&Object.keys(t).length>0)&&a.insertBefore(document.createComment(``),a.firstChild),Mn(o,a,`r`),T.node=null,o.freeze()},setDefaultStrategy(e){this.compile=e},aggregate(e,t=ye.policy){if(e.length===1)return e[0];let n,r=!1,a,o=e.length,s=e.map(e=>i(e)?()=>e:(n=e.sourceAspect||n,r||=e.dataBinding.isVolatile,a||=e.dataBinding.policy,e.dataBinding.evaluate)),c=new wn(me((e,t)=>{let n=``;for(let r=0;r<o;++r)n+=s[r](e,t);return n},a??t,r));return C.assignAspect(c,n),c}},Ln=class extends Pt{bind(e){e.source[this.options]=e.targets[this.targetNodeId]}};C.define(Ln);var Rn=e=>new Ln(e),zn=/([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/,Bn=Object.create(null),Vn=class{constructor(e,t=Bn){this.html=e,this.factories=t}createHTML(e){let t=this.factories;for(let n in t)e(t[n]);return this.html}};Vn.empty=new Vn(``),C.define(Vn);function Hn(e,t,n,r=C.getForInstance(e)){if(r.aspected){let n=zn.exec(t);n!==null&&C.assignAspect(e,n[2])}return e.createHTML(n)}var Un=class e{constructor(e,t={},n){this.policy=n,this.result=null,this.html=e,this.factories=t}compile(){return this.result===null&&(this.result=In.compile(this.html,this.factories,this.policy)),this.result}inline(){return new Vn(i(this.html)?this.html:this.html.innerHTML,this.factories)}withPolicy(e){if(this.result)throw s.error(n.cannotSetTemplatePolicyAfterCompilation);if(this.policy)throw s.error(n.onlySetTemplatePolicyOnce);return this.policy=e,this}render(e,t,n){let r=this.create(n);return r.bind(e),r.appendTo(t),r}create(e){return this.compile().createView(e)}static create(n,i,a){let o=``,s=Object.create(null),c=e=>{let t=e.id??=At();return s[t]=e,t};for(let e=0,a=n.length-1;e<a;++e){let a=n[e],s=i[e],l;if(o+=a,r(s))s=new wn(me(s));else if(s instanceof t)s=new wn(s);else if(!(l=C.getForInstance(s))){let e=s;s=new wn(te(()=>e))}o+=Hn(s,a,c,l)}return new e(o+n[n.length-1],s,a)}};d(Un);var E=((e,...t)=>{if(Array.isArray(e)&&Array.isArray(e.raw))return Un.create(e,t);throw s.error(n.directCallToHTMLTagNotAllowed)});E.partial=e=>new Vn(e);var Wn=`slotchange`,Gn=class extends Ft{observe(e){e.addEventListener(Wn,this)}disconnect(e){e.removeEventListener(Wn,this)}getNodes(e){return e.assignedNodes(this.options)}handleEvent(e){let t=e.currentTarget;this.updateTarget(this.getSource(t),this.computeNodes(t))}};C.define(Gn);function Kn(e){return i(e)&&(e={property:e}),new Gn(e)}function qn(e){return e?typeof e==`string`?new Vn(e):`inline`in e?e.inline():e:Vn.empty}var Jn=class{};function Yn(e){return E` <slot name="end" ${Rn(`end`)}>${qn(e.end)}</slot> `.inline()}function Xn(e){return E` <slot name="start" ${Rn(`start`)}>${qn(e.start)}</slot> `.inline()}function Zn(e,...t){let n=Se.locate(e);t.forEach(t=>{Object.getOwnPropertyNames(t.prototype).forEach(n=>{n!==`constructor`&&Object.defineProperty(e.prototype,n,Object.getOwnPropertyDescriptor(t.prototype,n))}),Se.locate(t).forEach(e=>n.push(e))})}var D=Object.freeze({prefix:`fluent`,shadowRootMode:`open`,registry:globalThis.customElements});function Qn(e){return t=>t?.nodeType===Node.ELEMENT_NODE&&t.tagName.toLowerCase().endsWith(e)}var $n=`:host([hidden]){display:none}`;function O(e){return`${$n}:host{display:${e}}`}var k=`var(--colorNeutralForeground1)`,er=`var(--colorNeutralForeground1Hover)`,tr=`var(--colorNeutralForeground1Pressed)`,nr=`var(--colorNeutralForeground2)`,rr=`var(--colorNeutralForeground2Hover)`,ir=`var(--colorNeutralForeground2Pressed)`,ar=`var(--colorNeutralForeground2BrandHover)`,or=`var(--colorNeutralForeground2BrandPressed)`,A=`var(--colorNeutralForeground3)`,sr=`var(--colorNeutralForeground3Hover)`,cr=`var(--colorNeutralForeground3Pressed)`,lr=`var(--colorNeutralForeground4)`,ur=`var(--colorNeutralForegroundDisabled)`,dr=`var(--colorNeutralForegroundOnBrand)`,fr=`var(--colorNeutralForegroundInverted)`,pr=`var(--colorNeutralForegroundInvertedHover)`,mr=`var(--colorNeutralForegroundInvertedPressed)`,hr=`var(--colorNeutralForegroundStaticInverted)`,gr=`var(--colorBrandForeground1)`,_r=`var(--colorBrandForeground2)`,vr=`var(--colorNeutralForeground1Static)`,j=`var(--colorNeutralBackground1)`,yr=`var(--colorNeutralBackground1Hover)`,br=`var(--colorNeutralBackground1Pressed)`,xr=`var(--colorNeutralBackground3)`,Sr=`var(--colorNeutralBackground4)`,Cr=`var(--colorNeutralBackground5)`,wr=`var(--colorNeutralBackgroundInverted)`,Tr=`var(--colorSubtleBackground)`,Er=`var(--colorSubtleBackgroundHover)`,Dr=`var(--colorSubtleBackgroundPressed)`,Or=`var(--colorTransparentBackground)`,kr=`var(--colorTransparentBackgroundHover)`,Ar=`var(--colorTransparentBackgroundPressed)`,jr=`var(--colorNeutralBackgroundDisabled)`,Mr=`var(--colorBackgroundOverlay)`,Nr=`var(--colorBrandBackground)`,Pr=`var(--colorBrandBackgroundHover)`,Fr=`var(--colorBrandBackgroundPressed)`,Ir=`var(--colorCompoundBrandBackground)`,Lr=`var(--colorCompoundBrandBackgroundHover)`,Rr=`var(--colorCompoundBrandBackgroundPressed)`,zr=`var(--colorBrandBackground2)`,Br=`var(--colorNeutralStrokeAccessible)`,Vr=`var(--colorNeutralStrokeAccessibleHover)`,Hr=`var(--colorNeutralStrokeAccessiblePressed)`,Ur=`var(--colorNeutralStroke1)`,Wr=`var(--colorNeutralStroke1Hover)`,Gr=`var(--colorNeutralStroke1Pressed)`,Kr=`var(--colorNeutralStroke2)`,qr=`var(--colorNeutralStroke3)`,Jr=`var(--colorNeutralStrokeOnBrand2)`,Yr=`var(--colorBrandStroke1)`,Xr=`var(--colorBrandStroke2)`,Zr=`var(--colorCompoundBrandStroke)`,Qr=`var(--colorCompoundBrandStrokeHover)`,$r=`var(--colorCompoundBrandStrokePressed)`,M=`var(--colorNeutralStrokeDisabled)`,N=`var(--colorTransparentStroke)`,ei=`var(--colorStrokeFocus2)`,ti=`var(--colorPaletteRedBackground1)`,ni=`var(--colorPaletteRedBackground3)`,ri=`var(--colorPaletteRedBorder1)`,ii=`var(--colorPaletteRedBorder2)`,ai=`var(--colorPaletteRedForeground1)`,oi=`var(--colorPaletteRedForeground3)`,si=`var(--colorPaletteGreenBackground1)`,ci=`var(--colorPaletteGreenBackground3)`,li=`var(--colorPaletteGreenBorder1)`,ui=`var(--colorPaletteGreenBorder2)`,di=`var(--colorPaletteGreenForeground1)`,fi=`var(--colorPaletteGreenForeground2)`,pi=`var(--colorPaletteGreenForeground3)`,mi=`var(--colorPaletteDarkOrangeBackground1)`,hi=`var(--colorPaletteDarkOrangeBackground3)`,gi=`var(--colorPaletteDarkOrangeBorder1)`,_i=`var(--colorPaletteDarkOrangeForeground1)`,vi=`var(--colorPaletteDarkOrangeForeground3)`,yi=`var(--colorPaletteYellowBackground1)`,bi=`var(--colorPaletteYellowBackground3)`,xi=`var(--colorPaletteYellowBorder1)`,Si=`var(--colorPaletteYellowForeground2)`,Ci=`var(--borderRadiusNone)`,wi=`var(--borderRadiusSmall)`,P=`var(--borderRadiusMedium)`,Ti=`var(--borderRadiusLarge)`,Ei=`var(--borderRadiusXLarge)`,Di=`var(--borderRadiusCircular)`,Oi=`var(--fontFamilyBase)`,ki=`var(--fontSizeBase100)`,Ai=`var(--fontSizeBase200)`,ji=`var(--fontSizeBase300)`,Mi=`var(--fontSizeBase400)`,Ni=`var(--fontWeightRegular)`,Pi=`var(--fontWeightSemibold)`,Fi=`var(--lineHeightBase100)`,Ii=`var(--lineHeightBase200)`,Li=`var(--lineHeightBase300)`,Ri=`var(--lineHeightBase400)`,zi=`var(--shadow2)`,Bi=`var(--shadow4)`,Vi=`var(--shadow64)`,F=`var(--strokeWidthThin)`,Hi=`var(--strokeWidthThick)`,Ui=`var(--strokeWidthThicker)`,Wi=`var(--strokeWidthThickest)`,Gi=`var(--spacingHorizontalXXS)`,Ki=`var(--spacingHorizontalXS)`,qi=`var(--spacingHorizontalSNudge)`,Ji=`var(--spacingHorizontalS)`,Yi=`var(--spacingHorizontalMNudge)`,Xi=`var(--spacingHorizontalM)`,Zi=`var(--spacingHorizontalL)`,Qi=`var(--spacingHorizontalXXL)`,$i=`var(--spacingVerticalXS)`,ea=`var(--spacingVerticalSNudge)`,ta=`var(--spacingVerticalS)`,na=`var(--spacingVerticalMNudge)`,ra=`var(--spacingVerticalL)`,ia=`var(--durationUltraFast)`,aa=`var(--durationFaster)`,oa=`var(--durationNormal)`,sa=`var(--durationGentle)`,ca=`var(--curveAccelerateMid)`,la=`var(--curveDecelerateMid)`,ua=`var(--curveEasyEase)`,da=`var(--curveLinear)`,fa={submit:`submit`,reset:`reset`,button:`button`},pa=`${D.prefix}-button`,ma={filled:`filled`,ghost:`ghost`,outline:`outline`,tint:`tint`},ha={brand:`brand`,danger:`danger`,important:`important`,informative:`informative`,severe:`severe`,subtle:`subtle`,success:`success`,warning:`warning`},ga=`${D.prefix}-badge`,_a=S.partial`
  ${O(`inline-flex`)} :host {
    position: relative;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    font-family: ${Oi};
    font-weight: ${Pi};
    font-size: ${Ai};
    line-height: ${Ii};
    min-width: 20px;
    height: 20px;
    padding-inline: calc(${Ki} + ${Gi});
    border-radius: ${Di};
    border-color: ${N};
    background-color: ${Nr};
    color: ${dr};
    contain: content;
  }

  ::slotted(svg) {
    font-size: 12px;
  }

  :host(:not([appearance='ghost']))::after {
    position: absolute;
    content: '';
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    border-style: solid;
    border-width: ${F};
    border-color: inherit;
    border-radius: inherit;
  }
`,va=S.partial`
  :host([size='tiny']) {
    width: 6px;
    height: 6px;
    font-size: 4px;
    line-height: 4px;
    padding-inline: 0;
    min-width: unset;
  }
  :host([size='tiny']) ::slotted(svg) {
    font-size: 6px;
  }
  :host([size='extra-small']) {
    width: 10px;
    height: 10px;
    font-size: 6px;
    line-height: 6px;
    padding-inline: 0;
    min-width: unset;
  }
  :host([size='extra-small']) ::slotted(svg) {
    font-size: 10px;
  }
  :host([size='small']) {
    min-width: 16px;
    height: 16px;
    font-size: ${ki};
    line-height: ${Fi};
    padding-inline: calc(${Gi} + ${Gi});
  }
  :host([size='small']) ::slotted(svg) {
    font-size: 12px;
  }
  :host([size='large']) {
    min-width: 24px;
    height: 24px;
    font-size: ${Ai};
    line-height: ${Ii};
    padding-inline: calc(${Ki} + ${Gi});
  }
  :host([size='large']) ::slotted(svg) {
    font-size: 16px;
  }
  :host([size='extra-large']) {
    min-width: 32px;
    height: 32px;
    font-size: ${Ai};
    line-height: ${Ii};
    padding-inline: calc(${qi} + ${Gi});
  }
  :host([size='extra-large']) ::slotted(svg) {
    font-size: 20px;
  }
`,ya=S.partial`
  :host([color='danger']) {
    background-color: ${ni};
    color: ${dr};
  }

  :host([color='important']) {
    background-color: ${k};
    color: ${j};
  }

  :host([color='informative']) {
    background-color: ${Cr};
    color: ${A};
  }

  :host([color='severe']) {
    background-color: ${hi};
    color: ${dr};
  }

  :host([color='subtle']) {
    background-color: ${j};
    color: ${k};
  }

  :host([color='success']) {
    background-color: ${ci};
    color: ${dr};
  }

  :host([color='warning']) {
    background-color: ${bi};
    color: ${vr};
  }
`,ba=S.partial`
  :host([appearance='ghost']) {
    color: ${gr};
    background-color: initial;
  }

  :host([appearance='ghost'][color='danger']) {
    color: ${oi};
  }

  :host([appearance='ghost'][color='important']) {
    color: ${k};
  }

  :host([appearance='ghost'][color='informative']) {
    color: ${A};
  }

  :host([appearance='ghost'][color='severe']) {
    color: ${vi};
  }

  :host([appearance='ghost'][color='subtle']) {
    color: ${fr};
  }

  :host([appearance='ghost'][color='success']) {
    color: ${pi};
  }

  :host([appearance='ghost'][color='warning']) {
    color: ${Si};
  }
`,xa=S.partial`
  :host([appearance='outline']) {
    border-color: currentColor;
    color: ${gr};
    background-color: initial;
  }

  :host([appearance='outline'][color='danger']) {
    color: ${oi};
  }

  :host([appearance='outline'][color='important']) {
    color: ${A};
    border-color: ${Br};
  }

  :host([appearance='outline'][color='informative']) {
    color: ${A};
    border-color: ${Kr};
  }

  :host([appearance='outline'][color='severe']) {
    color: ${vi};
  }

  :host([appearance='outline'][color='subtle']) {
    color: ${hr};
  }

  :host([appearance='outline'][color='success']) {
    color: ${fi};
  }

  :host([appearance='outline'][color='warning']) {
    color: ${Si};
  }
`,Sa=S`
  :host([shape='square']) {
    border-radius: ${Ci};
  }

  :host([shape='rounded']) {
    border-radius: ${P};
  }

  :host([shape='rounded']:is([size='tiny'], [size='extra-small'], [size='small'])) {
    border-radius: ${wi};
  }

  ${S.partial`
  :host([appearance='tint']) {
    background-color: ${zr};
    color: ${_r};
    border-color: ${Xr};
  }

  :host([appearance='tint'][color='danger']) {
    background-color: ${ti};
    color: ${ai};
    border-color: ${ri};
  }

  :host([appearance='tint'][color='important']) {
    background-color: ${A};
    color: ${j};
    border-color: ${N};
  }

  :host([appearance='tint'][color='informative']) {
    background-color: ${Sr};
    color: ${A};
    border-color: ${Kr};
  }

  :host([appearance='tint'][color='severe']) {
    background-color: ${mi};
    color: ${_i};
    border-color: ${gi};
  }

  :host([appearance='tint'][color='subtle']) {
    background-color: ${j};
    color: ${A};
    border-color: ${Kr};
  }

  :host([appearance='tint'][color='success']) {
    background-color: ${si};
    color: ${di};
    border-color: ${ui};
  }

  :host([appearance='tint'][color='warning']) {
    background-color: ${yi};
    color: ${Si};
    border-color: ${xi};
  }
`}
  ${xa}
  ${ba}
  ${ya}
  ${va}
  ${_a}

  @media (forced-colors: active) {
    :host,
    :host([appearance='outline']),
    :host([appearance='tint']) {
      border-color: CanvasText;
    }
  }
`;function Ca(e={}){return E`
    ${Xn(e)}
    <slot>${qn(e.defaultContent)}</slot>
    ${Yn(e)}
  `}var wa=Ca(),Ta={name:ga,registry:D.registry,styles:Sa,template:wa},Ea=class extends b{constructor(){super(...arguments),this.appearance=ma.filled,this.color=ha.brand}};e([v],Ea.prototype,`appearance`,void 0),e([v],Ea.prototype,`color`,void 0),e([v],Ea.prototype,`shape`,void 0),e([v],Ea.prototype,`size`,void 0),Zn(Ea,Jn);var Da=S`
  ${S`
  ${O(`inline-flex`)}

  :host {
    --icon-spacing: ${qi};
    position: relative;
    contain: layout style;
    vertical-align: middle;
    align-items: center;
    box-sizing: border-box;
    justify-content: center;
    text-align: center;
    text-decoration-line: none;
    margin: 0;
    min-height: 32px;
    outline-style: none;
    background-color: ${j};
    color: ${k};
    border: ${F} solid ${Ur};
    padding: 0 ${Xi};
    min-width: 96px;
    border-radius: ${P};
    font-size: ${ji};
    font-family: ${Oi};
    font-weight: ${Pi};
    line-height: ${Li};
    transition-duration: ${aa};
    transition-property: background, border, color;
    transition-timing-function: ${ua};
    cursor: pointer;
    user-select: none;
  }

  .content {
    display: inherit;
  }

  :host(:hover) {
    background-color: ${yr};
    color: ${er};
    border-color: ${Wr};
  }

  :host(:hover:active) {
    background-color: ${br};
    border-color: ${Gr};
    color: ${tr};
    outline-style: none;
  }

  :host(:focus-visible) {
    border-color: ${N};
    outline: ${Hi} solid ${N};
    box-shadow: ${Bi}, 0 0 0 2px ${ei};
  }

  @media screen and (prefers-reduced-motion: reduce) {
    :host {
      transition-duration: 0.01ms;
    }
  }

  ::slotted(svg) {
    font-size: 20px;
    height: 20px;
    width: 20px;
    fill: currentColor;
  }

  ::slotted([slot='start']) {
    margin-inline-end: var(--icon-spacing);
  }

  ::slotted([slot='end']),
  [slot='end'] {
    flex-shrink: 0;
    margin-inline-start: var(--icon-spacing);
  }

  :host([icon-only]) {
    min-width: 32px;
    max-width: 32px;
  }

  :host([size='small']) {
    --icon-spacing: ${Ki};
    min-height: 24px;
    min-width: 64px;
    padding: 0 ${Ji};
    border-radius: ${wi};
    font-size: ${Ai};
    line-height: ${Ii};
    font-weight: ${Ni};
  }

  :host([size='small'][icon-only]) {
    min-width: 24px;
    max-width: 24px;
  }

  :host([size='large']) {
    min-height: 40px;
    border-radius: ${Ti};
    padding: 0 ${Zi};
    font-size: ${Mi};
    line-height: ${Ri};
  }

  :host([size='large'][icon-only]) {
    min-width: 40px;
    max-width: 40px;
  }

  :host([size='large']) ::slotted(svg) {
    font-size: 24px;
    height: 24px;
    width: 24px;
  }

  :host(:is([shape='circular'], [shape='circular']:focus-visible)) {
    border-radius: ${Di};
  }

  :host(:is([shape='square'], [shape='square']:focus-visible)) {
    border-radius: ${Ci};
  }

  :host([appearance='primary']) {
    background-color: ${Nr};
    color: ${dr};
    border-color: transparent;
  }

  :host([appearance='primary']:hover) {
    background-color: ${Pr};
  }

  :host([appearance='primary']:is(:hover, :hover:active):not(:focus-visible)) {
    border-color: transparent;
  }

  :host([appearance='primary']:is(:hover, :hover:active)) {
    color: ${dr};
  }

  :host([appearance='primary']:hover:active) {
    background-color: ${Fr};
  }

  :host([appearance='primary']:focus-visible) {
    border-color: ${dr};
    box-shadow: ${zi}, 0 0 0 2px ${ei};
  }

  :host([appearance='outline']) {
    background-color: ${Or};
  }

  :host([appearance='outline']:hover) {
    background-color: ${kr};
  }

  :host([appearance='outline']:hover:active) {
    background-color: ${Ar};
  }

  :host([appearance='subtle']) {
    background-color: ${Tr};
    color: ${nr};
    border-color: transparent;
  }

  :host([appearance='subtle']:hover) {
    background-color: ${Er};
    color: ${rr};
    border-color: transparent;
  }

  :host([appearance='subtle']:hover:active) {
    background-color: ${Dr};
    color: ${ir};
    border-color: transparent;
  }

  :host([appearance='subtle']:hover) ::slotted(svg) {
    fill: ${ar};
  }

  :host([appearance='subtle']:hover:active) ::slotted(svg) {
    fill: ${or};
  }

  :host([appearance='transparent']) {
    background-color: ${Or};
    color: ${nr};
  }

  :host([appearance='transparent']:hover) {
    background-color: ${kr};
    color: ${ar};
  }

  :host([appearance='transparent']:hover:active) {
    background-color: ${Ar};
    color: ${or};
  }

  :host(:is([appearance='transparent'], [appearance='transparent']:is(:hover, :active))) {
    border-color: transparent;
  }
`}

  :host(:is(:disabled, [disabled-focusable], [appearance]:disabled, [appearance][disabled-focusable])),
  :host(:is(:disabled, [disabled-focusable], [appearance]:disabled, [appearance][disabled-focusable]):hover),
  :host(:is(:disabled, [disabled-focusable], [appearance]:disabled, [appearance][disabled-focusable]):hover:active) {
    background-color: ${jr};
    border-color: ${M};
    color: ${ur};
    cursor: not-allowed;
  }

  :host([appearance='primary']:is(:disabled, [disabled-focusable])),
  :host([appearance='primary']:is(:disabled, [disabled-focusable]):is(:hover, :hover:active)) {
    border-color: transparent;
  }

  :host([appearance='outline']:is(:disabled, [disabled-focusable])),
  :host([appearance='outline']:is(:disabled, [disabled-focusable]):is(:hover, :hover:active)) {
    background-color: ${Or};
  }

  :host([appearance='subtle']:is(:disabled, [disabled-focusable])),
  :host([appearance='subtle']:is(:disabled, [disabled-focusable]):is(:hover, :hover:active)) {
    background-color: ${Or};
    border-color: transparent;
  }

  :host([appearance='transparent']:is(:disabled, [disabled-focusable])),
  :host([appearance='transparent']:is(:disabled, [disabled-focusable]):is(:hover, :hover:active)) {
    border-color: transparent;
    background-color: ${Or};
  }

  @media (forced-colors: active) {
    :host {
      background-color: ButtonFace;
      color: ButtonText;
    }

    :host(:is(:hover, :focus-visible)) {
      border-color: Highlight !important;
    }

    :host([appearance='primary']:not(:is(:hover, :focus-visible))) {
      background-color: Highlight;
      color: HighlightText;
      forced-color-adjust: none;
    }

    :host(:is(:disabled, [disabled-focusable], [appearance]:disabled, [appearance][disabled-focusable])) {
      background-color: ButtonFace;
      color: GrayText;
      border-color: ButtonText;
    }
  }
`;function Oa(e={}){return E`
    <template
      @click="${(e,t)=>e.clickHandler(t.event)}"
      @keypress="${(e,t)=>e.keypressHandler(t.event)}"
    >
      ${Xn(e)}
      <span class="content" part="content">
        <slot ${Kn(`defaultSlottedContent`)}></slot>
      </span>
      ${Yn(e)}
    </template>
  `}var ka=Oa(),Aa={name:pa,registry:D.registry,styles:Da,template:ka};function ja(e){let t=e.ownerDocument;e?.isConnected&&e?.hasAttribute(`autofocus`)&&e?.checkVisibility?.({contentVisibilityAuto:!0,visibilityProperty:!0})&&[null,e,t.body,t.documentElement].includes(t.activeElement)&&m.enqueue(()=>{e.focus()})}var I=class extends b{disabledChanged(){this.setTabIndex()}disabledFocusableChanged(e,t){this.elementInternals&&(this.elementInternals.ariaDisabled=`${!!t}`)}get form(){return this.elementInternals.form}static{this.formAssociated=!0}get labels(){return Object.freeze(Array.from(this.elementInternals.labels))}typeChanged(e,t){t!==fa.submit&&(this.formSubmissionFallbackControl?.remove(),this.shadowRoot?.querySelector(`slot[name="internal"]`)?.remove())}clickHandler(e){if(e&&this.disabledFocusable){e.stopImmediatePropagation();return}return this.press(),!0}connectedCallback(){super.connectedCallback(),this.elementInternals.ariaDisabled=`${!!this.disabledFocusable}`,this.setTabIndex(),ja(this)}constructor(){super(),this.disabledFocusable=!1,this.elementInternals=this.attachInternals(),this.elementInternals.role=`button`}createAndInsertFormSubmissionFallbackControl(){let e=this.formSubmissionFallbackControlSlot??document.createElement(`slot`);e.setAttribute(`name`,`internal`),this.shadowRoot?.appendChild(e),this.formSubmissionFallbackControlSlot=e;let t=this.formSubmissionFallbackControl??document.createElement(`button`);t.style.display=`none`,t.setAttribute(`type`,`submit`),t.setAttribute(`slot`,`internal`),this.formNoValidate&&t.toggleAttribute(`formnovalidate`,!0),this.elementInternals.form?.id&&t.setAttribute(`form`,this.elementInternals.form.id),this.name&&t.setAttribute(`name`,this.name),this.value&&t.setAttribute(`value`,this.value),this.formAction&&t.setAttribute(`formaction`,this.formAction??``),this.formEnctype&&t.setAttribute(`formenctype`,this.formEnctype??``),this.formMethod&&t.setAttribute(`formmethod`,this.formMethod??``),this.formTarget&&t.setAttribute(`formtarget`,this.formTarget??``),this.append(t),this.formSubmissionFallbackControl=t}formDisabledCallback(e){this.disabled=e}keypressHandler(e){if(e&&this.disabledFocusable){e.stopImmediatePropagation();return}if(e.key===`Enter`||e.key===` `){this.click();return}return!0}press(){switch(this.type){case fa.reset:this.resetForm();break;case fa.submit:this.submitForm();break}}resetForm(){this.elementInternals.form?.reset()}setTabIndex(){if(this.disabled){this.removeAttribute(`tabindex`);return}this.tabIndex=Number(this.getAttribute(`tabindex`)??0)<0?-1:0}submitForm(){if(!(!this.elementInternals.form||this.disabled||this.type!==fa.submit)){if(!this.name&&!this.formAction&&!this.formEnctype&&!this.formAttribute&&!this.formMethod&&!this.formNoValidate&&!this.formTarget){this.elementInternals.form.requestSubmit();return}try{this.elementInternals.setFormValue(this.value??``),this.elementInternals.form.requestSubmit(this)}catch{this.createAndInsertFormSubmissionFallbackControl(),this.elementInternals.setFormValue(null),this.elementInternals.form.requestSubmit(this.formSubmissionFallbackControl)}}}};e([g],I.prototype,`defaultSlottedContent`,void 0),e([v({mode:`boolean`})],I.prototype,`disabled`,void 0),e([v({attribute:`disabled-focusable`,mode:`boolean`})],I.prototype,`disabledFocusable`,void 0),e([v({attribute:`formaction`})],I.prototype,`formAction`,void 0),e([v({attribute:`form`})],I.prototype,`formAttribute`,void 0),e([v({attribute:`formenctype`})],I.prototype,`formEnctype`,void 0),e([v({attribute:`formmethod`})],I.prototype,`formMethod`,void 0),e([v({attribute:`formnovalidate`,mode:`boolean`})],I.prototype,`formNoValidate`,void 0),e([v({attribute:`formtarget`})],I.prototype,`formTarget`,void 0),e([v],I.prototype,`name`,void 0),e([v],I.prototype,`type`,void 0),e([v],I.prototype,`value`,void 0);var Ma=class extends I{constructor(){super(...arguments),this.iconOnly=!1}};e([v],Ma.prototype,`appearance`,void 0),e([v],Ma.prototype,`shape`,void 0),e([v],Ma.prototype,`size`,void 0),e([v({attribute:`icon-only`,mode:`boolean`})],Ma.prototype,`iconOnly`,void 0),Zn(Ma,Jn);var Na=`${D.prefix}-checkbox`;CSS.supports(`anchor-name: --a`),`anchor`in HTMLElement.prototype;var Pa=CSS.supports(`selector(:state(g))`),Fa=new Map;function L(e){return Fa.get(e)??Fa.set(e,Pa?`:state(${e})`:`[state--${e}]`).get(e)}function R(e,t,n){if(!(!t||!e)){if(!Pa){e.shadowRoot.host.toggleAttribute(`state--${t}`,n);return}if(n??!e.states.has(t)){e.states.add(t);return}e.states.delete(t)}}var Ia=new WeakMap;function La(e,t){if(!e||!t)return!1;if(Ia.has(e))return Ia.get(e).has(t);let n=new Set(Object.values(e));return Ia.set(e,n),n.has(t)}function Ra(e,t=``,n=``,r,i=``){R(e,`${i}${t}`,!1),(!r||La(r,n))&&R(e,`${i}${n}`,!0)}L(`active`),L(`bad-input`);var z=L(`checked`);L(`custom-error`),L(`description`);var za=L(`disabled`);L(`error`),L(`flip-block`),L(`focus-visible`),L(`has-message`);var Ba=L(`indeterminate`);L(`multiple`),L(`open`),L(`pattern-mismatch`),L(`placeholder-shown`),L(`pressed`),L(`range-overflow`),L(`range-underflow`),L(`required`),L(`selected`),L(`step-mismatch`),L(`submenu`),L(`too-long`),L(`too-short`),L(`type-mismatch`);var Va=L(`user-invalid`);L(`valid`),L(`value-missing`);var Ha=S`
  ${O(`inline-flex`)}

  :host {
    --size: 16px;
    background-color: ${j};
    border-radius: ${wi};
    border: ${F} solid ${Br};
    box-sizing: border-box;
    cursor: pointer;
    position: relative;
    width: var(--size);
  }

  :host,
  .indeterminate-indicator,
  .checked-indicator {
    aspect-ratio: 1;
  }

  :host(:hover) {
    border-color: ${Vr};
  }

  :host(:active) {
    border-color: ${Hr};
  }

  :host(${z}:hover) {
    background-color: ${Lr};
    border-color: ${Qr};
  }

  :host(${z}:active) {
    background-color: ${Rr};
    border-color: ${$r};
  }

  :host(:focus-visible) {
    outline: none;
  }

  :host(:not([slot='input']))::after {
    content: '';
    position: absolute;
    inset: -8px;
    box-sizing: border-box;
    outline: none;
    border: ${Hi} solid ${N};
    border-radius: ${P};
  }

  :host(:not([slot='input']):focus-visible)::after {
    border-color: ${ei};
  }

  .indeterminate-indicator,
  .checked-indicator {
    color: ${fr};
    inset: 0;
    margin: auto;
    position: absolute;
  }

  ::slotted([slot='checked-indicator']),
  .checked-indicator {
    fill: currentColor;
    display: inline-flex;
    flex: 1 0 auto;
    width: 12px;
  }

  :host(:not(${z})) *:is(::slotted([slot='checked-indicator']), .checked-indicator) {
    display: none;
  }

  :host(${z}),
  :host(${Ba}) {
    border-color: ${Zr};
  }

  :host(${z}),
  :host(${Ba}) .indeterminate-indicator {
    background-color: ${Ir};
  }

  :host(${Ba}) .indeterminate-indicator {
    border-radius: ${wi};
    position: absolute;
    width: calc(var(--size) / 2);
    inset: 0;
  }

  :host([size='large']) {
    --size: 20px;
  }

  :host([size='large']) ::slotted([slot='checked-indicator']),
  :host([size='large']) .checked-indicator {
    width: 16px;
  }

  :host([shape='circular']),
  :host([shape='circular']) .indeterminate-indicator {
    border-radius: ${Di};
  }

  :host([disabled]),
  :host([disabled]${z}) {
    background-color: ${jr};
    border-color: ${M};
  }

  :host([disabled]) {
    cursor: unset;
  }

  :host([disabled]${Ba}) .indeterminate-indicator {
    background-color: ${M};
  }

  :host([disabled]${z}) .checked-indicator {
    color: ${M};
  }

  @media (forced-colors: active) {
    :host {
      border-color: FieldText;
    }

    :host(:not([slot='input']:focus-visible))::after {
      border-color: Canvas;
    }

    :host(:not([disabled]):hover),
    :host(${z}:not([disabled]):hover),
    :host(:not([slot='input']):focus-visible)::after {
      border-color: Highlight;
    }

    .indeterminate-indicator,
    .checked-indicator {
      color: HighlightText;
    }

    :host(${z}),
    :host(${Ba}) .indeterminate-indicator {
      background-color: FieldText;
    }

    :host(${z}:not([disabled]):hover),
    :host(${Ba}:not([disabled]):hover) .indeterminate-indicator {
      background-color: Highlight;
    }

    :host([disabled]) {
      border-color: GrayText;
    }

    :host([disabled]${Ba}) .indeterminate-indicator {
      background-color: GrayText;
    }

    :host([disabled]),
    :host([disabled]${z}) .checked-indicator {
      color: GrayText;
    }
  }
`,Ua=E.partial(`
    <svg
        fill="currentColor"
        aria-hidden="true"
        class="checked-indicator"
        width="1em"
        height="1em"
        viewBox="0 0 12 12"
        xmlns="http://www.w3.org/2000/svg">
            <path d="M9.76 3.2c.3.29.32.76.04 1.06l-4.25 4.5a.75.75 0 0 1-1.08.02L2.22 6.53a.75.75 0 0 1 1.06-1.06l1.7 1.7L8.7 3.24a.75.75 0 0 1 1.06-.04Z" fill="currentColor"></path>
    </svg>
`),Wa=E.partial(`
    <span class="indeterminate-indicator"></span>
`);function Ga(e={}){return E`
    <template
      @click="${(e,t)=>e.clickHandler(t.event)}"
      @input="${(e,t)=>e.inputHandler(t.event)}"
      @keydown="${(e,t)=>e.keydownHandler(t.event)}"
      @keyup="${(e,t)=>e.keyupHandler(t.event)}"
    >
      <slot name="checked-indicator">${qn(e.checkedIndicator)}</slot>
      <slot name="indeterminate-indicator">${qn(e.indeterminateIndicator)}</slot>
    </template>
  `}var Ka=Ga({checkedIndicator:Ua,indeterminateIndicator:Wa}),qa={name:Na,registry:D.registry,styles:Ha,template:Ka},B=class extends b{constructor(){super(...arguments),this.initialValue=`on`,this._keydownPressed=!1,this.dirtyChecked=!1,this.elementInternals=this.attachInternals(),this._validationFallbackMessage=``,this._value=this.initialValue}get checked(){return h.track(this,`checked`),!!this._checked}set checked(e){this._checked=e,this.setFormValue(e?this.value:null),this.setValidity(),this.setAriaChecked(),R(this.elementInternals,`checked`,e),h.notify(this,`checked`)}disabledChanged(e,t){this.disabled?this.removeAttribute(`tabindex`):this.tabIndex=Number(this.getAttribute(`tabindex`)??0)<0?-1:0,this.elementInternals.ariaDisabled=this.disabled?`true`:`false`,R(this.elementInternals,`disabled`,this.disabled)}disabledAttributeChanged(e,t){this.disabled=!!t}initialCheckedChanged(e,t){this.dirtyChecked||(this.checked=!!t)}initialValueChanged(e,t){this._value=t}requiredChanged(e,t){this.elementInternals&&(this.setValidity(),this.elementInternals.ariaRequired=this.required?`true`:`false`)}get form(){return this.elementInternals.form}static{this.formAssociated=!0}get labels(){return Object.freeze(Array.from(this.elementInternals.labels))}get validationMessage(){if(this.elementInternals?.validationMessage)return this.elementInternals.validationMessage;if(!this._validationFallbackMessage){let e=document.createElement(`input`);e.type=`checkbox`,e.required=!0,e.checked=!1,this._validationFallbackMessage=e.validationMessage}return this._validationFallbackMessage}get validity(){return this.elementInternals.validity}get value(){return h.track(this,`value`),this._value}set value(e){this._value=e,this.elementInternals&&(this.setFormValue(e),this.setValidity()),h.notify(this,`value`)}get willValidate(){return this.elementInternals.willValidate}checkValidity(){return this.elementInternals.checkValidity()}clickHandler(e){if(this.disabled)return;this.dirtyChecked=!0;let t=this.checked;return this.toggleChecked(),t!==this.checked&&(this.$emit(`change`),this.$emit(`input`)),!0}connectedCallback(){super.connectedCallback(),this.disabled=!!this.disabledAttribute,this.setAriaChecked(),this.setValidity(),ja(this)}inputHandler(e){return this.setFormValue(this.value),this.setValidity(),!0}keydownHandler(e){if(e.key!==` `)return!0;this._keydownPressed=!0}keyupHandler(e){if(!this._keydownPressed||e.key!==` `)return!0;this._keydownPressed=!1,this.click()}formResetCallback(){this.checked=this.initialChecked??!1,this.dirtyChecked=!1,this.setValidity()}reportValidity(){return this.elementInternals.reportValidity()}setAriaChecked(e=this.checked){this.elementInternals&&(this.elementInternals.ariaChecked=e?`true`:`false`)}setFormValue(e,t){this.elementInternals?.setFormValue(e,e??t)}setCustomValidity(e){this.elementInternals.setValidity({customError:!0},e),this.setValidity()}setValidity(e,t,n){if(this.elementInternals){if(this.disabled||!this.required){this.elementInternals.setValidity({});return}this.elementInternals.setValidity({valueMissing:!!this.required&&!this.checked,...e},t??this.validationMessage,n)}}toggleChecked(e=!this.checked){this.checked=e}};e([g],B.prototype,`disabled`,void 0),e([v({attribute:`disabled`,mode:`boolean`})],B.prototype,`disabledAttribute`,void 0),e([v({attribute:`form`})],B.prototype,`formAttribute`,void 0),e([v({attribute:`checked`,mode:`boolean`})],B.prototype,`initialChecked`,void 0),e([v({attribute:`value`,mode:`fromView`})],B.prototype,`initialValue`,void 0),e([v],B.prototype,`name`,void 0),e([v({mode:`boolean`})],B.prototype,`required`,void 0);var Ja=class extends B{indeterminateChanged(e,t){this.setAriaChecked(),R(this.elementInternals,`indeterminate`,t)}constructor(){super(),this.elementInternals.role=`checkbox`}setAriaChecked(e=this.checked){if(this.indeterminate){this.elementInternals.ariaChecked=`mixed`;return}super.setAriaChecked(e)}toggleChecked(e=!this.checked){this.indeterminate=!1,super.toggleChecked(e)}};e([g],Ja.prototype,`indeterminate`,void 0),e([v],Ja.prototype,`shape`,void 0),e([v],Ja.prototype,`size`,void 0);var Ya={modal:`modal`,nonModal:`non-modal`,alert:`alert`},Xa=`${D.prefix}-dialog`,V=class extends b{constructor(){super(...arguments),this.emitToggle=()=>{this.$emit(`toggle`,{oldState:this.dialog.open?`closed`:`open`,newState:this.dialog.open?`open`:`closed`})}}get dialogDescribedby(){if(this.dialog)return this.ariaDescribedby}get dialogLabel(){if(this.dialog)return this.ariaLabel}get dialogLabelledby(){if(this.dialog)return this.ariaLabelledby}get dialogModal(){if(this.dialog&&this.type!==Ya.nonModal)return!0}get dialogRole(){if(this.dialog&&this.type===Ya.alert)return`alertdialog`}connectedCallback(){super.connectedCallback(),m.enqueue(()=>{this.type=this.type??Ya.modal})}emitBeforeToggle(){this.$emit(`beforetoggle`,{oldState:this.dialog.open?`open`:`closed`,newState:this.dialog.open?`closed`:`open`})}show(){m.enqueue(()=>{this.emitBeforeToggle(),this.type===Ya.alert||this.type===Ya.modal?this.dialog.showModal():this.type===Ya.nonModal&&this.dialog.show(),this.querySelector(`[autofocus]`)?.focus?.(),this.emitToggle()})}hide(){this.emitBeforeToggle(),this.dialog.close(),this.emitToggle()}clickHandler(e){return this.dialog.open&&this.type!==Ya.alert&&e.target===this.dialog&&this.hide(),!0}};e([g],V.prototype,`dialog`,void 0),e([v({attribute:`aria-describedby`})],V.prototype,`ariaDescribedby`,void 0),e([v({attribute:`aria-labelledby`})],V.prototype,`ariaLabelledby`,void 0),e([v({attribute:`aria-label`})],V.prototype,`ariaLabel`,void 0),e([v],V.prototype,`type`,void 0),e([x],V.prototype,`dialogDescribedby`,null),e([x],V.prototype,`dialogLabel`,null),e([x],V.prototype,`dialogLabelledby`,null),e([x],V.prototype,`dialogModal`,null),e([x],V.prototype,`dialogRole`,null);var Za=S`
  @layer base {
    :host {
      --dialog-backdrop: ${Mr};
      --dialog-starting-scale: 0.85;
    }

    ::backdrop {
      background: var(--dialog-backdrop, rgba(0, 0, 0, 0.4));
    }

    dialog {
      background: ${j};
      border-radius: ${Ei};
      border: none;
      box-shadow: ${Vi};
      color: ${k};
      max-height: 100vh;
      padding: 0;
      width: 100%;
      max-width: 600px;
    }

    :host([type='non-modal']) dialog {
      inset: 0;
      z-index: 2;
      overflow: auto;
    }

    @supports (max-height: 1dvh) {
      dialog {
        max-height: 100dvh;
      }
    }
  }

  @layer animations {
    /* Disable animations for reduced motion */
    @media (prefers-reduced-motion: no-preference) {
      dialog,
      ::backdrop {
        transition: display allow-discrete, opacity, overlay allow-discrete, scale;
        transition-duration: ${sa};
        transition-timing-function: ${la};
        /* Set opacity to 0 when closed */
        opacity: 0;
      }
      ::backdrop {
        transition-timing-function: ${da};
      }

      /* Set opacity to 1 when open */
      [open],
      [open]::backdrop {
        opacity: 1;
      }

      /* Exit styles for dialog */
      dialog:not([open]) {
        /* Make small when leaving */
        scale: var(--dialog-starting-scale);
        /* Faster leaving the stage then entering */
        transition-timing-function: ${ca};
      }
    }

    @starting-style {
      [open],
      [open]::backdrop {
        opacity: 0;
      }

      dialog {
        scale: var(--dialog-starting-scale);
      }
    }
  }

  @media (forced-colors: active) {
    @layer base {
      dialog {
        border: ${F} solid ${N};
      }
    }
  }
`,Qa=E`
  <dialog
    class="dialog"
    part="dialog"
    aria-modal="${e=>e.dialogModal}"
    aria-describedby="${e=>e.dialogDescribedby}"
    aria-labelledby="${e=>e.dialogLabelledby}"
    aria-label="${e=>e.dialogLabel}"
    role="${e=>e.dialogRole}"
    @click="${(e,t)=>e.clickHandler(t.event)}"
    @cancel="${e=>e.hide()}"
    ${Rn(`dialog`)}
  >
    <div tabindex="-1"></div>
    <slot></slot>
  </dialog>
`,$a={name:Xa,registry:D.registry,styles:Za,template:Qa},eo={horizontal:`horizontal`,vertical:`vertical`},to={separator:`separator`,presentation:`presentation`},no=eo,ro=`${D.prefix}-divider`,io=class extends b{constructor(){super(...arguments),this.elementInternals=this.attachInternals()}connectedCallback(){super.connectedCallback(),this.elementInternals.role=this.role??to.separator,this.role!==to.presentation&&(this.elementInternals.ariaOrientation=this.orientation??no.horizontal)}roleChanged(e,t){this.$fastController.isConnected&&(this.elementInternals.role=`${t??to.separator}`),t===to.presentation&&(this.elementInternals.ariaOrientation=null)}orientationChanged(e,t){this.elementInternals.ariaOrientation=this.role===to.presentation?null:t??null,Ra(this.elementInternals,e,t,no)}};e([v],io.prototype,`role`,void 0),e([v],io.prototype,`orientation`,void 0);var ao=class extends io{};e([v({attribute:`align-content`})],ao.prototype,`alignContent`,void 0),e([v],ao.prototype,`appearance`,void 0),e([v({mode:`boolean`})],ao.prototype,`inset`,void 0);var oo=S`
  ${O(`flex`)}

  :host {
    contain: content;
  }

  :host::after,
  :host::before {
    align-self: center;
    background: ${Kr};
    box-sizing: border-box;
    content: '';
    display: flex;
    flex-grow: 1;
    height: ${F};
  }

  :host([inset]) {
    padding: 0 12px;
  }

  :host ::slotted(*) {
    color: ${nr};
    font-family: ${Oi};
    font-size: ${Ai};
    font-weight: ${Ni};
    margin: 0;
    padding: 0 12px;
  }

  :host([align-content='start'])::before,
  :host([align-content='end'])::after {
    flex-basis: 12px;
    flex-grow: 0;
    flex-shrink: 0;
  }

  :host([orientation='vertical']) {
    align-items: center;
    flex-direction: column;
    height: 100%;
    min-height: 84px;
  }

  :host([orientation='vertical']):empty {
    min-height: 20px;
  }

  :host([orientation='vertical'][inset])::before {
    margin-top: 12px;
  }
  :host([orientation='vertical'][inset])::after {
    margin-bottom: 12px;
  }

  :host([orientation='vertical']):empty::before,
  :host([orientation='vertical']):empty::after {
    height: 10px;
    min-height: 10px;
    flex-grow: 0;
  }

  :host([orientation='vertical'])::before,
  :host([orientation='vertical'])::after {
    width: ${F};
    min-height: 20px;
    height: 100%;
  }

  :host([orientation='vertical']) ::slotted(*) {
    display: flex;
    flex-direction: column;
    padding: 12px 0;
    line-height: 20px;
  }

  :host([orientation='vertical'][align-content='start'])::before {
    min-height: 8px;
  }
  :host([orientation='vertical'][align-content='end'])::after {
    min-height: 8px;
  }

  :host([appearance='strong'])::before,
  :host([appearance='strong'])::after {
    background: ${Ur};
  }
  :host([appearance='strong']) ::slotted(*) {
    color: ${k};
  }
  :host([appearance='brand'])::before,
  :host([appearance='brand'])::after {
    background: ${Yr};
  }
  :host([appearance='brand']) ::slotted(*) {
    color: ${gr};
  }
  :host([appearance='subtle'])::before,
  :host([appearance='subtle'])::after {
    background: ${qr};
  }
  :host([appearance='subtle']) ::slotted(*) {
    color: ${A};
  }

  @media (forced-colors: active) {
    :host([appearance='strong'])::before,
    :host([appearance='strong'])::after,
    :host([appearance='brand'])::before,
    :host([appearance='brand'])::after,
    :host([appearance='subtle'])::before,
    :host([appearance='subtle'])::after,
    :host::after,
    :host::before {
      background: WindowText;
      color: WindowText;
    }
  }
`;function so(){return E`<slot></slot>`}var co=so(),lo={name:ro,registry:D.registry,styles:oo,template:co},uo={start:`start`,end:`end`},fo={small:`small`,medium:`medium`,large:`large`,full:`full`},po={nonModal:`non-modal`,modal:`modal`,inline:`inline`},mo=`${D.prefix}-drawer`,H=class extends b{constructor(){super(...arguments),this.position=uo.start,this.size=fo.medium,this.emitToggle=()=>{this.$emit(`toggle`,{oldState:this.dialog.open?`closed`:`open`,newState:this.dialog.open?`open`:`closed`})},this.emitBeforeToggle=()=>{this.$emit(`beforetoggle`,{oldState:this.dialog.open?`open`:`closed`,newState:this.dialog.open?`closed`:`open`})}}get dialogDescribedby(){if(this.dialog)return this.ariaDescribedby}get dialogLabel(){if(this.dialog)return this.ariaLabel}get dialogLabelledby(){if(this.dialog)return this.ariaLabelledby}get dialogModal(){if(this.dialog&&this.type===po.modal)return!0}get dialogRole(){return this.dialog&&this.type===po.modal?`dialog`:this.role}connectedCallback(){super.connectedCallback(),m.enqueue(()=>{this.type=this.type??po.modal})}show(){m.enqueue(()=>{this.emitBeforeToggle(),this.type===po.inline||this.type===po.nonModal?this.dialog.show():this.dialog.showModal(),this.querySelector(`[autofocus]`)?.focus?.(),this.emitToggle()})}hide(){this.emitBeforeToggle(),this.dialog.close(),this.emitToggle()}clickHandler(e){return this.dialog.open&&e.target===this.dialog&&this.hide(),!0}cancelHandler(){this.hide()}};e([v],H.prototype,`type`,void 0),e([v({attribute:`aria-labelledby`})],H.prototype,`ariaLabelledby`,void 0),e([v({attribute:`aria-describedby`})],H.prototype,`ariaDescribedby`,void 0),e([v],H.prototype,`position`,void 0),e([g],H.prototype,`role`,void 0),e([v({attribute:`size`})],H.prototype,`size`,void 0),e([g],H.prototype,`dialog`,void 0),e([x],H.prototype,`dialogDescribedby`,null),e([x],H.prototype,`dialogLabel`,null),e([x],H.prototype,`dialogLabelledby`,null),e([x],H.prototype,`dialogModal`,null),e([x],H.prototype,`dialogRole`,null);var ho=S`
  ${O(`block`)}

  :host {
    --dialog-backdrop: ${Mr};
  }

  :host([type='non-modal']) dialog[open]::backdrop {
    display: none;
  }

  :host([type='non-modal']) dialog {
    position: fixed;
    top: 0;
    bottom: 0;
  }

  :host([type='inline']) {
    height: 100%;
    width: fit-content;
  }

  :host([type='inline']) dialog[open] {
    box-shadow: none;
    position: relative;
  }

  :host([size='small']) dialog {
    width: 320px;
    max-width: 320px;
  }

  :host([size='large']) dialog {
    width: 940px;
    max-width: 940px;
  }

  :host([size='full']) dialog {
    width: 100%;
    max-width: 100%;
  }

  :host([position='end']) dialog {
    margin-inline-start: auto;
    margin-inline-end: 0;
  }

  dialog {
    background: ${j};
    border-radius: 0;
    border: ${F} solid ${N};
    border-inline-end-color: ${N};
    border-inline-start-color: var(--drawer-separator, ${N});
    box-shadow: ${Vi};
    box-sizing: border-box;
    color: ${k};
    font-family: ${Oi};
    font-size: ${ji};
    font-weight: ${Ni};
    height: 100%;
    line-height: ${Li};
    margin-inline-end: auto;
    margin-inline-start: 0;
    max-height: 100vh;
    max-width: calc(100vw - ${Qi});
    outline: none;
    padding: 0;
    bottom: 0;
    top: 0;
    width: var(--drawer-width, 592px);
    z-index: var(--drawer-elevation, 1000);
  }

  dialog::backdrop {
    background: var(--dialog-backdrop);
  }

  @layer animations {
    /* Disable animations for reduced motion */
    @media (prefers-reduced-motion: no-preference) {
      dialog {
        transition: display allow-discrete, opacity, overlay allow-discrete, transform;
        transition-duration: ${sa};
        transition-timing-function: ${la};
      }

      /* Exit styles for dialog */
      :host dialog:not([open]) {
        transform: translateX(-100%);
        transition-timing-function: ${ca};
      }
      :host([position='end']) dialog:not([open]) {
        transform: translateX(100%);
        transition-timing-function: ${ca};
      }

      dialog[open] {
        transform: translateX(0);
      }

      dialog::backdrop {
        transition: display allow-discrete, opacity, overlay allow-discrete, scale;
        transition-duration: ${sa};
        transition-timing-function: ${la};
        background: var(--dialog-backdrop, ${Mr});
        opacity: 0;
      }

      dialog[open]::backdrop {
        opacity: 1;
      }

      dialog::backdrop {
        transition-timing-function: ${da};
      }
    }

    @starting-style {
      dialog[open] {
        transform: translateX(-100%);
      }
      :host([position='end']) dialog[open] {
        transform: translateX(100%);
      }
      dialog[open]::backdrop {
        opacity: 0;
      }
    }
  }
`;function go(){return E`
    <dialog
      class="dialog"
      part="dialog"
      aria-describedby="${e=>e.dialogDescribedby}"
      aria-labelledby="${e=>e.dialogLabelledby}"
      aria-label="${e=>e.dialogLabel}"
      aria-modal="${e=>e.dialogModal}"
      role="${e=>e.dialogRole}"
      size="${e=>e.size}"
      position="${e=>e.position}"
      @click="${(e,t)=>e.clickHandler(t.event)}"
      @cancel="${e=>e.cancelHandler()}"
      ${Rn(`dialog`)}
    >
      <slot></slot>
    </dialog>
  `}var _o=go(),vo={name:mo,registry:D.registry,styles:ho,template:_o},yo=0;function bo(e=`id-`){let t=`${e}${yo++}`;return document.getElementById(t)?bo(e):t}var xo=`${D.prefix}-message-bar`,So=S`
  :host {
    display: grid;
    box-sizing: border-box;
    font-family: ${Oi};
    font-size: ${Ai};
    line-height: ${Ii};
    width: 100%;
    background: ${xr};
    color: ${A};
    border: 1px solid ${Ur};
    padding-inline: ${Xi};
    border-radius: ${P};
    min-height: 36px;
    align-items: center;
    grid-template: 'icon body actions dismiss' / auto 1fr auto auto;
    contain: layout style paint;
  }

  :host([shape='square']) {
    border-radius: 0;
  }

  :host([intent='success']) {
    background-color: ${si};
    border-color: ${li};
  }

  :host([intent='warning']) {
    background-color: ${mi};
    border-color: ${gi};
  }

  :host([intent='error']) {
    background-color: ${ti};
    border-color: ${ri};
  }

  :host([layout='multiline']) {
    grid-template-areas:
      'icon body dismiss'
      'actions actions actions';
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto auto 1fr;
    padding-block: ${na};
    padding-inline: ${Xi};
  }

  .content {
    grid-area: body;
    max-width: 520px;
    padding-block: ${na};
    padding-inline: 0;
  }

  :host([layout='multiline']) .content {
    padding: 0;
  }

  ::slotted([slot='icon']) {
    display: flex;
    grid-area: icon;
    flex-direction: column;
    align-items: center;
    color: ${A};
    margin-inline-end: ${Ji};
  }

  :host([layout='multiline']) ::slotted([slot='icon']) {
    align-items: start;
    height: 100%;
  }

  ::slotted([slot='dismiss']) {
    grid-area: dismiss;
  }

  .actions {
    grid-area: actions;
    display: flex;
    justify-self: end;
    margin-inline-end: ${Ji};
    gap: ${Ji};
  }

  :host([layout='multiline']) .actions {
    margin-block-start: ${na};
    margin-inline-end: 0;
  }

  :host([layout='multiline']) ::slotted([slot='dismiss']) {
    align-items: start;
    height: 100%;
    padding-block-start: ${ta};
  }

  ::slotted(*) {
    font-size: inherit;
  }
`;function Co(){return E`
    <slot name="icon"></slot>
    <div class="content">
      <slot></slot>
    </div>
    <div class="actions">
      <slot name="actions"></slot>
    </div>
    <slot name="dismiss"></slot>
  `}var wo=Co(),To={name:xo,registry:D.registry,styles:So,template:wo},Eo=class extends b{constructor(){super(),this.elementInternals=this.attachInternals(),this.dismissMessageBar=()=>{this.$emit(`dismiss`,{})},this.elementInternals.role=`status`}};e([v],Eo.prototype,`shape`,void 0),e([v],Eo.prototype,`layout`,void 0),e([v],Eo.prototype,`intent`,void 0);var Do={INFERRED_ROLE:`data-fg-ir`,ITEM:`data-fg-item`,AUTHOR_TABINDEX:`data-fg-ati`,SEGMENT:`data-fg-seg`,SEGMENT_START:`data-fg-segs`},U={TOOLBAR:`toolbar`,TABLIST:`tablist`,RADIOGROUP:`radiogroup`,LISTBOX:`listbox`,MENU:`menu`,MENUBAR:`menubar`,NONE:`none`};U.TOOLBAR,U.TABLIST,U.RADIOGROUP,U.LISTBOX,U.MENU,U.MENUBAR,U.NONE;function Oo(e,t){return e.contains(t)}function ko(){return`focusgroup`in(globalThis?.HTMLElement?.prototype??{})||`focusGroup`in(globalThis?.HTMLElement?.prototype??{})}function Ao(e,t,n){let r=`forward`,i=`backward`,a=`block`,o=`inline`;if(jo(e.composedPath()[0]))return e.key===`Tab`?e.shiftKey?i:r:null;if(e.shiftKey||e.ctrlKey||e.metaKey)return null;let{writingMode:s,direction:c}=window.getComputedStyle(t),l=!s.startsWith(`horizontal-`),u=c===`rtl`,d=l?a:o,ee=l?o:a,te=l?s.endsWith(`-rl`)!==u:u,f=l&&u,ne={ArrowUp:{axis:ee,dir:f?r:i},ArrowDown:{axis:ee,dir:f?i:r},ArrowLeft:{axis:d,dir:te?r:i},ArrowRight:{axis:d,dir:te?i:r},Home:{dir:`start`},End:{dir:`end`}}[e.key];return!ne||n&&ne.axis&&ne.axis!==n?null:ne.dir}function jo(e){return e?.nodeType===Node.ELEMENT_NODE&&([`INPUT`,`TEXTAREA`,`SELECT`].includes(e.nodeName)&&![`checkbox`,`radio`].includes(e.getAttribute(`type`))||e.isContentEditable||[`AUDIO`,`VIDEO`].includes(e.nodeName)&&e.hasAttribute(`controls`)||[`IFRAME`,`OBJECT`].includes(e.nodeName))}globalThis.__FOCUSGROUP_POLYFILL__??={o:new Set,b:!1};var Mo=globalThis.__FOCUSGROUP_POLYFILL__.o;function No(){for(let e of Mo)e.takeRecords()}var Po=class{#e;#t;#n=U.NONE;#r=void 0;#i=!1;#a=!0;#o;#s=null;#c=!1;#l=null;#u=new AbortController;#d;#f;constructor(e,t,n={}){if(ko()||!e)return;this.#e=e,this.#t=t,this.#d=n.decorateOwner,this.#f=n.decorateItem,this.#p(n.definition),this.#d?.(this.#e,this.#n),this.#m();let r={signal:this.#u.signal};this.#e.addEventListener(`keydown`,this.#g.bind(this),r),this.#e.addEventListener(`focusin`,this.#_.bind(this),r),this.#e.addEventListener(`focusout`,this.#v.bind(this),r)}disconnect(){this.#b(),this.#u.abort(),this.#t?.disconnect?.(),this.#e=null}update(e={}){if(this.#e){if(e.definition!==void 0&&(this.#p(e.definition),this.#d?.(this.#e,this.#n)),e.authorTabindexChanges)for(let t of e.authorTabindexChanges)t.setAttribute(Do.AUTHOR_TABINDEX,t.getAttribute(`tabindex`)??`none`);this.#h(),this.#m()}}#p(e){this.#n=e?.behavior??U.NONE,this.#i=e?.wrap??!1,this.#r=e?.axis,this.#a=e?.memory??!0,this.#a||(this.#s=null)}#m(){if(this.#n===U.NONE){this.#h();return}this.#t.decorate?.();for(let{element:e,segmentBoundary:t}of this.#t.items())this.#f?.(e,this.#n),e.setAttribute(Do.AUTHOR_TABINDEX,e.getAttribute(`tabindex`)??`none`),e.tabIndex=t?0:-1;(!this.#s?.isConnected||!(this.#t.isItem?.(this.#s)??this.#t.contains(this.#s)))&&(this.#s=null);let e=this.#s??this.#t.start??this.#t.first?.()??null;e&&(e.tabIndex=0,this.#o=e,this.#b(),this.#y(e)),this.#t.flush?.()}#h(){this.#b();let e=!1;for(let{element:t}of this.#t.items()){e=!0,this.#f?.(t,null);let n=t.getAttribute(Do.AUTHOR_TABINDEX);n&&(n===`none`?t.removeAttribute(`tabindex`):t.setAttribute(`tabindex`,n),t.removeAttribute(Do.AUTHOR_TABINDEX))}this.#t.undecorate?.(),e&&this.#t.flush?.()}#g(e){let t=e.composedPath()[0];if(e.defaultPrevented||t===this.#e||!this.#t.contains(t))return;let n;switch(Ao(e,t,this.#r)){case`start`:n=this.#t.first();break;case`end`:n=this.#t.last();break;case`forward`:n=this.#t.next(t),!n&&this.#i&&(n=this.#t.first());break;case`backward`:n=this.#t.previous(t),!n&&this.#i&&(n=this.#t.last());break}n&&n!==t&&(this.#x(t,n,!0),this.#s=n,e.preventDefault())}#_(e){let t=e.composedPath()[0];if(t===this.#e&&this.#c&&(!e.relatedTarget||!Oo(this.#e,e.relatedTarget))){let t=this.#s||this.#o;this.#b(),t&&t.focus(),e.stopPropagation();return}if(!this.#t.contains(t))return;this.#c&&this.#b();let n=this.#s;if(this.#s=t,n!==t&&t.tabIndex<0){let e=n??this.#o;e&&this.#x(e,t)}}#v(e){if(!e.relatedTarget||!Oo(this.#e,e.relatedTarget)){let e=this.#a&&this.#s||this.#o;e&&this.#y(e)}if(e.relatedTarget&&Oo(this.#e,e.relatedTarget)||this.#a||!this.#o)return;let t=this.#s;this.#s=null;let n=this.#t.start??this.#t.first?.()??null;if(t!==this.#o||n!==this.#o){for(let{element:e,segmentBoundary:t}of this.#t.items())e.tabIndex=t?0:-1;n&&(n.tabIndex=0,this.#o=n),this.#t.flush?.()}}#y(e){let t=(e.assignedSlot??e).getRootNode(),n=t instanceof ShadowRoot&&t.host.hasAttribute(Do.AUTHOR_TABINDEX);this.#c||!n||(this.#l=this.#e.getAttribute(`tabindex`),this.#e.tabIndex=0,this.#c=!0,No())}#b(){this.#c&&(this.#l===null?this.#e.removeAttribute(`tabindex`):this.#e.setAttribute(`tabindex`,this.#l),this.#c=!1,this.#l=null,this.#t.flush?.(),No())}#x(e,t,n=!1){t.tabIndex=0,n&&t.focus(),e.tabIndex=this.#t.sameSegment?.(e,t)??!0?-1:0,this.#b(),No()}},Fo=class{constructor(e,t){this.getItems=e,this.getStart=t}get start(){return this.getStart?.()??null}first(){return this.getItems()[0]??null}last(){let e=this.getItems();return e[e.length-1]??null}next(e){let t=this.getItems(),n=t.indexOf(e);return n===-1?null:t[n+1]??null}previous(e){let t=this.getItems(),n=t.indexOf(e);return n<=0?null:t[n-1]??null}*items(){for(let e of this.getItems())yield{element:e}}contains(e){return this.getItems().includes(e)}};function Io(e,t=`-radio`){return Qn(t)(e)}var Lo=`${D.prefix}-radio`,Ro=eo,zo=`${D.prefix}-radio-group`,Bo=class extends b{checkedIndexChanged(e,t){this.enabledRadios&&this.checkRadio(t)}disabledChanged(e,t){this.radios&&(this.checkedIndex=-1,this.radios?.forEach(e=>{e.disabled=!!e.disabledAttribute||!!this.disabled}))}initialValueChanged(e,t){this.value=t??``}nameChanged(e,t){this.isConnected&&t&&this.radios?.forEach(e=>{e.name=this.name})}orientationChanged(e,t){this.elementInternals.ariaOrientation=this.orientation??Ro.horizontal}radiosChanged(e,t){let n=t?.length;if(!n)return;!this.name&&t.every(e=>e.name===t[0].name)&&(this.name=t[0].name);let r=this.enabledRadios.findLastIndex(e=>e.initialChecked);t.forEach((e,t)=>{e.ariaPosInSet=`${t+1}`,e.ariaSetSize=`${n}`,this.initialValue&&!this.dirtyState?e.checked=e.value===this.initialValue:e.checked=t===r,e.name=this.name??e.name,e.disabled=!!this.disabled||!!e.disabledAttribute,e.toggleAttribute(`focusgroupstart`,e.checked&&!e.disabled)}),!this.dirtyState&&this.initialValue&&(this.value=this.initialValue),(!this.value||this.value&&typeof this.checkedIndex!=`number`&&r>=0)&&(this.checkedIndex=r);let i=t.map(e=>e.id).join(` `).trim();i&&this.setAttribute(`aria-owns`,i)}requiredChanged(e,t){this.elementInternals.ariaRequired=t?`true`:null,this.setValidity()}slottedRadiosChanged(e,t){m.enqueue(()=>{this.radios=[...this.querySelectorAll(`*`)].filter(e=>Io(e))})}get enabledRadios(){return this.disabled?[]:this.radios?.filter(e=>!e.disabled)??[]}static{this.formAssociated=!0}get validationMessage(){if(this.elementInternals.validationMessage)return this.elementInternals.validationMessage;if(this.enabledRadios?.[0]?.validationMessage)return this.enabledRadios[0].validationMessage;if(!this._validationFallbackMessage){let e=document.createElement(`input`);e.type=`radio`,e.required=!0,e.checked=!1,this._validationFallbackMessage=e.validationMessage}return this._validationFallbackMessage}get validity(){return this.elementInternals.validity}get value(){return h.notify(this,`value`),this.enabledRadios.find(e=>e.checked)?.value??null}set value(e){let t=this.enabledRadios.findIndex(t=>t.value===e);this.checkedIndex=t,this.$fastController.isConnected&&(this.setFormValue(e),this.setValidity()),h.track(this,`value`)}changeHandler(e){if(this===e.target)return!0;this.dirtyState=!0;let t=this.enabledRadios.indexOf(e.target);return this.checkRadio(t),this.radios?.filter(e=>e.disabled)?.forEach(e=>{e.checked=!1}),!0}checkRadio(e=this.checkedIndex,t=!1){let n=this.checkedIndex;this.enabledRadios.forEach((r,i)=>{let a=i===e;r.checked=a,a&&(n=i,t&&r.$emit(`change`))}),this.checkedIndex=n,this.setFormValue(this.value),this.setValidity()}checkValidity(){return this.elementInternals.checkValidity()}clickHandler(e){return this===e.target&&this.enabledRadios[Math.max(0,this.checkedIndex)]?.focus(),!0}constructor(){super(),this.isNavigating=!1,this.dirtyState=!1,this.elementInternals=this.attachInternals(),this.elementInternals.role=`radiogroup`,this.elementInternals.ariaOrientation=this.orientation??Ro.horizontal}focus(){this.enabledRadios[Math.max(0,this.checkedIndex)]?.focus()}formResetCallback(){this.dirtyState=!1,this.checkedIndex=-1,this.setFormValue(this.value),this.setValidity()}focusinHandler(e){if(!this.disabled&&(this.isNavigating||this.value)){this.radios?.forEach(e=>{e.disabled&&e.checked&&(e.checked=!1)});let t=this.enabledRadios.indexOf(e.target);t>-1&&this.checkRadio(t,!0),this.isNavigating=!1}return!0}keydownHandler(e){switch(e.key){case`ArrowUp`:case`ArrowDown`:case`ArrowLeft`:case`ArrowRight`:case`Home`:case`End`:this.isNavigating=!0;break;case` `:this.checkRadio();break}return!0}disabledRadioHandler(e){e.detail===!0&&e.target.checked&&(this.checkedIndex=-1)}reportValidity(){return this.elementInternals.reportValidity()}setFormValue(e,t){this.elementInternals.setFormValue(e,e??t)}setValidity(e,t,n){if(this.$fastController.isConnected){if(!(this.required&&!this.value&&!this.disabled)){this.enabledRadios?.forEach(e=>{e.elementInternals.setValidity({})});return}let n={valueMissing:!0,...e},r=t??this.validationMessage;this.enabledRadios?.forEach((e,t)=>{t===0?e.elementInternals.setValidity(n,r,e):e.elementInternals.setValidity({})})}}};e([g],Bo.prototype,`checkedIndex`,void 0),e([v({attribute:`disabled`,mode:`boolean`})],Bo.prototype,`disabled`,void 0),e([v({attribute:`value`,mode:`fromView`})],Bo.prototype,`initialValue`,void 0),e([v],Bo.prototype,`name`,void 0),e([v],Bo.prototype,`orientation`,void 0),e([g],Bo.prototype,`radios`,void 0),e([v({mode:`boolean`})],Bo.prototype,`required`,void 0),e([g],Bo.prototype,`slottedRadios`,void 0);var Vo=class extends Bo{disconnectedCallback(){this.fg?.disconnect(),super.disconnectedCallback()}radiosChanged(e,t){super.radiosChanged(e,t),this.fgItems??=new Fo(()=>this.enabledRadios?.filter(e=>!e.hidden)??[],()=>this.enabledRadios?.find(e=>e.checked)??null),this.fg?this.fg.update():this.fg=new Po(this,this.fgItems,{definition:{behavior:`radiogroup`,axis:void 0,wrap:!0}})}},Ho=S`
  ${O(`flex`)}

  :host {
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
    gap: ${ra};
  }

  :host([orientation='vertical']) {
    flex-direction: column;
    justify-content: flex-start;
  }

  :host([orientation='horizontal']) {
    flex-direction: row;
  }

  ::slotted(*) {
    color: ${A};
  }

  ::slotted(:hover) {
    color: ${nr};
  }

  ::slotted(:active) {
    color: ${k};
  }

  ::slotted(${za}) {
    color: ${ur};
  }

  ::slotted(${z}) {
    color: ${k};
  }

  :host([slot='input']) {
    margin: ${ta} ${Ji};
  }
`;function Uo(){return E`
    <template
      focusgroup="radiogroup wrap"
      @disabled="${(e,t)=>e.disabledRadioHandler(t.event)}"
      @change="${(e,t)=>e.changeHandler(t.event)}"
      @click="${(e,t)=>e.clickHandler(t.event)}"
      @focusin="${(e,t)=>e.focusinHandler(t.event)}"
      @keydown="${(e,t)=>e.keydownHandler(t.event)}"
    >
      <slot ${Kn(`slottedRadios`)}></slot>
    </template>
  `}var Wo=Uo(),Go={name:zo,registry:D.registry,styles:Ho,template:Wo},Ko=S`
  ${O(`inline-flex`)}

  :host {
    --size: 16px;
    aspect-ratio: 1;
    background-color: ${j};
    border: ${F} solid ${Br};
    border-radius: ${Di};
    box-sizing: border-box;
    position: relative;
    width: var(--size);
  }

  :host([size='large']) {
    --size: 20px;
  }

  .checked-indicator {
    aspect-ratio: 1;
    border-radius: ${Di};
    color: ${fr};
    inset: 0;
    margin: auto;
    position: absolute;
    width: calc(var(--size) * 0.625);
  }

  :host(:not([slot='input']))::after {
    content: '' / '';
    position: absolute;
    display: block;
    inset: -8px;
    box-sizing: border-box;
    outline: none;
    border: ${Hi} solid ${N};
    border-radius: ${P};
  }

  :host(:not([slot='input']):focus-visible)::after {
    border-color: ${ei};
  }

  :host(:hover) {
    border-color: ${Vr};
  }

  :host(${z}) {
    border-color: ${Zr};
  }

  :host(${z}) .checked-indicator {
    background-color: ${Ir};
  }

  :host(${z}:hover) .checked-indicator {
    background-color: ${Lr};
  }

  :host(:active) {
    border-color: ${Hr};
  }

  :host(${z}:active) .checked-indicator {
    background-color: ${Rr};
  }

  :host(:focus-visible) {
    outline: none;
  }

  :host(${za}) {
    background-color: ${jr};
    border-color: ${M};
  }

  :host(${z}${za}) .checked-indicator {
    background-color: ${M};
  }

  @media (forced-colors: active) {
    :host {
      border-color: FieldText;
    }

    :host(:not([slot='input']:focus-visible))::after {
      border-color: Canvas;
    }

    :host(:not(${za}):hover),
    :host(:not([slot='input']):focus-visible)::after {
      border-color: Highlight;
    }

    .checked-indicator {
      color: HighlightText;
    }

    :host(${z}) .checked-indicator {
      background-color: FieldText;
    }

    :host(${z}:not(${za}):hover) .checked-indicator {
      background-color: Highlight;
    }

    :host(${za}) {
      border-color: GrayText;
      color: GrayText;
    }

    :host(${za}${z}) .checked-indicator {
      background-color: GrayText;
    }
  }
`,qo=E.partial(`
    <span part="checked-indicator" class="checked-indicator" role="presentation"></span>
`);function Jo(e={}){return E`
    <template
      @click="${(e,t)=>e.clickHandler(t.event)}"
      @keydown="${(e,t)=>e.keydownHandler(t.event)}"
      @keyup="${(e,t)=>e.keyupHandler(t.event)}"
    >
      <slot name="checked-indicator">${qn(e.checkedIndicator)}</slot>
    </template>
  `}var Yo=Jo({checkedIndicator:qo}),Xo={name:Lo,registry:D.registry,styles:Ko,template:Yo},Zo=class extends B{constructor(){super(),this.elementInternals.role=`radio`}disabledChanged(e,t){super.disabledChanged(e,t),this.$emit(`disabled`,t,{bubbles:!0})}requiredChanged(){}setFormValue(){}setValidity(){this.elementInternals.setValidity({})}toggleChecked(e=!0){super.toggleChecked(e)}},Qo=class extends b{constructor(){super(),this.elementInternals=this.attachInternals(),this.elementInternals.role=`progressbar`}},$o=class extends Qo{};e([v],$o.prototype,`size`,void 0),e([v],$o.prototype,`appearance`,void 0);var es=`${D.prefix}-spinner`,ts=E`
  <slot name="indicator">
    <div class="background"></div>
    <div class="progress">
      <div class="spinner">
        <div class="start">
          <div class="indicator"></div>
        </div>
        <div class="end">
          <div class="indicator"></div>
        </div>
      </div>
    </div>
  </slot>
`,ns=S`
  ${O(`inline-flex`)}

  :host {
    --duration: 1.5s;
    --indicatorSize: ${Ui};
    --size: 32px;
    height: var(--size);
    width: var(--size);
    contain: strict;
    content-visibility: auto;
  }

  :host([size='tiny']) {
    --indicatorSize: ${Hi};
    --size: 20px;
  }
  :host([size='extra-small']) {
    --indicatorSize: ${Hi};
    --size: 24px;
  }
  :host([size='small']) {
    --indicatorSize: ${Hi};
    --size: 28px;
  }
  :host([size='large']) {
    --indicatorSize: ${Ui};
    --size: 36px;
  }
  :host([size='extra-large']) {
    --indicatorSize: ${Ui};
    --size: 40px;
  }
  :host([size='huge']) {
    --indicatorSize: ${Wi};
    --size: 44px;
  }

  .progress,
  .background,
  .spinner,
  .start,
  .end,
  .indicator {
    position: absolute;
    inset: 0;
  }

  .progress,
  .spinner,
  .indicator {
    animation: none var(--duration) infinite ${ua};
  }

  .progress {
    animation-timing-function: linear;
    animation-name: spin-linear;
  }

  .background {
    border: var(--indicatorSize) solid ${Xr};
    border-radius: 50%;
  }

  :host([appearance='inverted']) .background {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .spinner {
    animation-name: spin-swing;
  }

  .start {
    overflow: hidden;
    right: 50%;
  }

  .end {
    overflow: hidden;
    left: 50%;
  }

  .indicator {
    color: ${Yr};
    box-sizing: border-box;
    border-radius: 50%;
    border: var(--indicatorSize) solid transparent;
    border-block-start-color: currentcolor;
    border-right-color: currentcolor;
  }

  :host([appearance='inverted']) .indicator {
    color: ${Jr};
  }

  .start .indicator {
    rotate: 135deg; /* Starts 9 o'clock */
    inset: 0 -100% 0 0;
    animation-name: spin-start;
  }

  .end .indicator {
    rotate: 135deg; /* Ends at 3 o'clock */
    inset: 0 0 0 -100%;
    animation-name: spin-end;
  }

  @keyframes spin-linear {
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes spin-swing {
    0% {
      transform: rotate(-135deg);
    }
    50% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(225deg);
    }
  }

  @keyframes spin-start {
    0%,
    100% {
      transform: rotate(0deg);
    }
    50% {
      transform: rotate(-80deg);
    }
  }

  @keyframes spin-end {
    0%,
    100% {
      transform: rotate(0deg);
    }
    50% {
      transform: rotate(70deg);
    }
  }

  @media (forced-colors: active) {
    .background {
      display: none;
    }
    .indicator {
      border-color: Canvas;
      border-block-start-color: Highlight;
      border-right-color: Highlight;
    }
  }
`,rs={name:es,registry:D.registry,styles:ns,template:ts},is=`${D.prefix}-switch`,as=S`
  ${O(`inline-flex`)}

  :host {
    box-sizing: border-box;
    align-items: center;
    flex-direction: row;
    outline: none;
    user-select: none;
    contain: content;
    padding: 0 ${Gi};
    width: 40px;
    height: 20px;
    background-color: ${Or};
    border: 1px solid ${Br};
    border-radius: ${Di};
  }

  :host(:enabled) {
    cursor: pointer;
  }

  :host(:hover) {
    background: none;
    border-color: ${Vr};
  }
  :host(:active) {
    border-color: ${Hr};
  }
  :host(:disabled),
  :host([readonly]) {
    border: 1px solid ${M};
    background-color: none;
    pointer: default;
  }
  :host(${z}) {
    background: ${Ir};
    border-color: ${Ir};
  }
  :host(${z}:hover) {
    background: ${Lr};
    border-color: ${Lr};
  }
  :host(${z}:active) {
    background: ${Rr};
    border-color: ${Rr};
  }
  :host(${z}:disabled) {
    background: ${jr};
    border-color: ${M};
  }
  .checked-indicator {
    height: 14px;
    width: 14px;
    border-radius: 50%;
    margin-inline-start: 0;
    background-color: ${A};
    transition-duration: ${oa};
    transition-timing-function: ${ua};
    transition-property: margin-inline-start;
  }
  :host(${z}) .checked-indicator {
    background-color: ${fr};
    margin-inline-start: calc(100% - 14px);
  }
  :host(${z}:hover) .checked-indicator {
    background: ${pr};
  }
  :host(${z}:active) .checked-indicator {
    background: ${mr};
  }
  :host(:hover) .checked-indicator {
    background-color: ${sr};
  }
  :host(:active) .checked-indicator {
    background-color: ${cr};
  }
  :host(:disabled) .checked-indicator,
  :host([readonly]) .checked-indicator {
    background: ${ur};
  }
  :host(${z}:disabled) .checked-indicator {
    background: ${ur};
  }

  :host(:focus-visible) {
    outline: none;
  }

  :host(:not([slot='input']):focus-visible) {
    border-color: ${N};
    outline: ${Hi} solid ${N};
    outline-offset: 1px;
    box-shadow: ${Bi}, 0 0 0 2px ${ei};
  }

  @media (forced-colors: active) {
    :host {
      border-color: InactiveBorder;
    }
    :host(${z}),
    :host(${z}:active),
    :host(${z}:hover) {
      background: Highlight;
      border-color: Highlight;
    }
    .checked-indicator,
    :host(:hover) .checked-indicator,
    :host(:active) .checked-indicator {
      background-color: ActiveCaption;
    }
    :host(${z}) .checked-indicator,
    :host(${z}:hover) .checked-indicator,
    :host(${z}:active) .checked-indicator {
      background-color: ButtonFace;
    }
    :host(:disabled) .checked-indicator,
    :host(${z}:disabled) .checked-indicator {
      background-color: GrayText;
    }
  }
`;function os(e={}){return E`
    <template
      @click="${(e,t)=>e.clickHandler(t.event)}"
      @input="${(e,t)=>e.inputHandler(t.event)}"
      @keydown="${(e,t)=>e.keydownHandler(t.event)}"
      @keyup="${(e,t)=>e.keyupHandler(t.event)}"
    >
      <slot name="switch">${qn(e.switch)}</slot>
    </template>
  `}var ss=os({switch:`<span class="checked-indicator" part="checked-indicator"></span>`}),cs={name:is,registry:D.registry,styles:as,template:ss},ls=class extends B{constructor(){super(),this.elementInternals.role=`switch`}},us={outline:`outline`,filledLighter:`filled-lighter`,filledDarker:`filled-darker`};us.filledLighter,us.filledDarker;var ds={none:`none`,both:`both`,horizontal:`horizontal`,vertical:`vertical`},fs=`${D.prefix}-textarea`,ps=S`
  ${O(`inline-block`)}

  :host {
    /* typography */
    --font-size: ${ji};
    --line-height: ${Li};

    /* layout */
    --padding-inline: ${Yi};
    --padding-block: ${ea};
    --min-block-size: 52px;
    --block-size: var(--min-block-size);
    --inline-size: 18rem;
    --border-width: ${F};
    --control-padding-inline: ${Gi};

    /* colors */
    --color: ${k};
    --background-color: ${j};
    --border-color: ${Ur};
    --border-block-end-color: ${Br};
    --placeholder-color: ${lr};
    --focus-indicator-color: ${Zr};

    /* elevations */
    --box-shadow: none;

    /* others */
    --contain-size: size;
    --resize: none;

    color: var(--color);
    font-family: ${Oi};
    font-size: var(--font-size);
    font-weight: ${Ni};
    line-height: var(--line-height);
    position: relative;
  }

  :host(:hover) {
    --border-color: ${Wr};
    --border-block-end-color: ${Vr};
  }

  :host(:active) {
    --border-color: ${Gr};
    --border-block-end-color: ${Hr};
  }

  :host(:focus-within) {
    outline: none;
  }

  :host([block]:not([hidden])) {
    display: block;
  }

  :host([size='small']) {
    --font-size: ${Ai};
    --line-height: ${Ii};
    --min-block-size: 40px;
    --padding-block: ${$i};
    --padding-inline: ${qi};
    --control-padding-inline: ${Gi};
  }

  :host([size='large']) {
    --font-size: ${Mi};
    --line-height: ${Ri};
    --min-block-size: 64px;
    --padding-block: ${ta};
    --padding-inline: ${Xi};
    --control-padding-inline: ${qi};
  }

  :host([resize='both']:not(:disabled)) {
    --resize: both;
  }

  :host([resize='horizontal']:not(:disabled)) {
    --resize: horizontal;
  }

  :host([resize='vertical']:not(:disabled)) {
    --resize: vertical;
  }

  :host([auto-resize]) {
    --block-size: auto;
    --contain-size: inline-size;
  }

  :host([appearance='filled-darker']) {
    --background-color: ${xr};
    --border-color: var(--background-color);
    --border-block-end-color: var(--border-color);
  }

  :host([appearance='filled-lighter']) {
    --border-color: var(--background-color);
    --border-block-end-color: var(--border-color);
  }

  :host([appearance='filled-darker'][display-shadow]),
  :host([appearance='filled-lighter'][display-shadow]) {
    --box-shadow: ${zi};
  }

  :host(${Va}) {
    --border-color: ${ii};
    --border-block-end-color: ${ii};
  }

  :host(:disabled) {
    --color: ${ur};
    --background-color: ${Or};
    --border-color: ${M};
    --border-block-end-color: var(--border-color);
    --box-shadow: none;
    --placeholder-color: ${ur};

    cursor: no-drop;
    user-select: none;
  }

  .root {
    background-color: var(--background-color);
    border: var(--border-width) solid var(--border-color);
    border-block-end-color: var(--border-block-end-color);
    border-radius: ${P};
    box-sizing: border-box;
    box-shadow: var(--box-shadow);
    contain: paint layout style var(--contain-size);
    display: grid;
    grid-template: 1fr / 1fr;
    inline-size: var(--inline-size);
    min-block-size: var(--min-block-size);
    block-size: var(--block-size);
    overflow: hidden;
    padding: var(--padding-block) var(--padding-inline);
    position: relative;
    resize: var(--resize);
  }

  :host([block]) .root {
    inline-size: auto;
  }

  .root::after {
    border-bottom: 2px solid var(--focus-indicator-color);
    border-radius: 0 0 ${P} ${P};
    box-sizing: border-box;
    clip-path: inset(calc(100% - 2px) 1px 0px);
    content: '';
    height: max(2px, ${P});
    inset: auto -1px 0;
    position: absolute;
    transform: scaleX(0);
    transition-delay: ${ca};
    transition-duration: ${ia};
    transition-property: transform;
  }

  :host(:focus-within) .root::after {
    transform: scaleX(1);
    transition-property: transform;
    transition-duration: ${oa};
    transition-delay: ${la};
  }

  :host([readonly]) .root::after,
  :host(:disabled) .root::after {
    content: none;
  }

  label {
    color: var(--color);
    display: flex;
    inline-size: fit-content;
    padding-block-end: ${$i};
    padding-inline-end: ${Ki};
  }

  :host(:empty) label,
  label[hidden] {
    display: none;
  }

  .auto-sizer,
  .control {
    box-sizing: border-box;
    font: inherit;
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    letter-space: inherit;
    padding: 0 var(--control-padding-inline);
  }

  .auto-sizer {
    display: none;
    padding-block-end: 2px; /* avoid scroll bar in Firefox */
    pointer-events: none;
    visibility: hidden;
    white-space: pre-wrap;
  }

  :host([auto-resize]) .auto-sizer {
    display: block;
  }

  .control {
    appearance: none;
    background-color: transparent;
    border: 0;
    color: inherit;
    field-sizing: content;
    max-block-size: 100%;
    outline: 0;
    resize: none;
    text-align: inherit;
  }

  .control:disabled {
    cursor: inherit;
  }

  .control::placeholder {
    color: var(--placeholder-color);
  }

  ::selection {
    color: ${fr};
    background-color: ${wr};
  }

  @media (forced-colors: active) {
    :host {
      --border-color: FieldText;
      --border-block-end-color: FieldText;
      --focus-indicator-color: Highlight;
      --placeholder-color: FieldText;
    }

    :host(:hover),
    :host(:active),
    :host(:focus-within) {
      --border-color: Highlight;
      --border-block-end-color: Highlight;
    }

    :host(:disabled) {
      --color: GrayText;
      --border-color: GrayText;
      --border-block-end-color: GrayText;
      --placeholder-color: GrayText;
    }
  }
`;function ms(){return E`
    <template>
      <label ${Rn(`labelEl`)} for="control" part="label">
        <slot name="label" ${Kn(`labelSlottedNodes`)}></slot>
      </label>
      <div class="root" part="root" ${Rn(`rootEl`)}>
        <textarea
          ${Rn(`controlEl`)}
          id="control"
          class="control"
          part="control"
          ?required="${e=>e.required}"
          ?disabled="${e=>e.disabled}"
          ?readonly="${e=>e.readOnly}"
          ?spellcheck="${e=>e.spellcheck}"
          autocomplete="${e=>e.autocomplete}"
          maxlength="${e=>e.maxLength}"
          minlength="${e=>e.minLength}"
          placeholder="${e=>e.placeholder}"
          @change="${e=>e.handleControlChange()}"
          @select="${e=>e.handleControlSelect()}"
          @input="${e=>e.handleControlInput()}"
        ></textarea>
      </div>
      <div hidden>
        <slot ${Kn(`defaultSlottedNodes`)}></slot>
      </div>
    </template>
  `}var hs=ms(),gs={name:fs,registry:D.registry,shadowOptions:{delegatesFocus:!0},styles:ps,template:hs},_s=e=>e.nodeType!==Node.TEXT_NODE||!!e.nodeValue?.trim().length,W=class extends b{static{this.formAssociated=!0}controlElChanged(){this.controlElAttrObserver=new MutationObserver(()=>{this.setValidity()}),this.controlElAttrObserver.observe(this.controlEl,{attributes:!0,attributeFilter:[`disabled`,`required`,`readonly`,`maxlength`,`minlength`]}),this.controlEl.addEventListener(`input`,()=>this.userInteracted=!0,{once:!0})}defaultSlottedNodesChanged(){m.enqueue(()=>{let e=this.getContent();this.defaultValue=e,this.value=e})}labelSlottedNodesChanged(){this.filteredLabelSlottedNodes=this.labelSlottedNodes.filter(_s),this.labelEl&&(this.labelEl.hidden=!this.filteredLabelSlottedNodes.length),this.filteredLabelSlottedNodes.forEach(e=>{e.disabled=this.disabled,e.required=this.required})}autoResizeChanged(){this.maybeCreateAutoSizerEl(),R(this.elementInternals,`auto-resize`,this.autoResize)}disabledChanged(){this.setDisabledSideEffect(this.disabled)}get form(){return this.elementInternals.form}get labels(){return this.elementInternals.labels}readOnlyChanged(){this.elementInternals&&(this.elementInternals.ariaReadOnly=`${!!this.readOnly}`,this.setValidity())}requiredChanged(){this.elementInternals.ariaRequired=`${!!this.required}`,this.filteredLabelSlottedNodes?.length&&this.filteredLabelSlottedNodes.forEach(e=>e.required=this.required)}resizeChanged(e,t){Ra(this.elementInternals,e,t,ds,`resize-`),R(this.elementInternals,`resize`,La(ds,t)&&t!==ds.none)}get textLength(){return this.controlEl.textLength}get type(){return`textarea`}get validity(){return this.elementInternals.validity}get validationMessage(){return this.elementInternals.validationMessage||this.controlEl.validationMessage}get willValidate(){return this.elementInternals.willValidate}get defaultValue(){return this.controlEl?.defaultValue??this.preConnectControlEl.defaultValue}set defaultValue(e){let t=this.controlEl??this.preConnectControlEl;t.defaultValue=e,this.controlEl&&!this.userInteracted&&(this.controlEl.value=e)}get value(){return this.controlEl?.value??this.preConnectControlEl.value}set value(e){let t=this.controlEl??this.preConnectControlEl;t.value=e,this.setFormValue(e),this.setValidity()}constructor(){super(),this.elementInternals=this.attachInternals(),this.filteredLabelSlottedNodes=[],this.labelSlottedNodes=[],this.userInteracted=!1,this.preConnectControlEl=document.createElement(`textarea`),this.autoResize=!1,this.disabled=!1,this.displayShadow=!1,this.readOnly=!1,this.required=!1,this.resize=ds.none,this.spellcheck=!1}connectedCallback(){super.connectedCallback(),requestAnimationFrame(()=>{if(!this.$fastController.isConnected)return;let e=this.preConnectControlEl,t=this.getContent();this.defaultValue=t||e?.defaultValue||``,this.value=e?.value||this.defaultValue,this.setFormValue(this.value),this.setValidity(),this.preConnectControlEl=null,this.maybeCreateAutoSizerEl(),ja(this)})}disconnectedCallback(){super.disconnectedCallback(),this.autoSizerObserver?.disconnect(),this.controlElAttrObserver?.disconnect()}formResetCallback(){this.value=this.defaultValue}formDisabledCallback(e){this.setDisabledSideEffect(e),this.setValidity()}setFormValue(e,t){this.elementInternals.setFormValue(e,e??t)}checkValidity(){return this.elementInternals.checkValidity()}reportValidity(){return this.elementInternals.reportValidity()}setCustomValidity(e){this.elementInternals?.setValidity({customError:!!e},e?e.toString():void 0),this.reportValidity()}setValidity(e,t,n){this.elementInternals&&(this.disabled||this.readOnly?this.elementInternals.setValidity({}):this.elementInternals.setValidity(e??this.controlEl?.validity,t??this.controlEl?.validationMessage,n??this.controlEl),this.userInteracted&&this.toggleUserValidityState())}select(){this.controlEl.select()}getContent(){return this.defaultSlottedNodes?.map(e=>{switch(e.nodeType){case Node.ELEMENT_NODE:return e.outerHTML;case Node.TEXT_NODE:return e.textContent.trim();default:return``}}).join(``)||``}setDisabledSideEffect(e){this.elementInternals.ariaDisabled=`${e}`,this.controlEl&&(this.controlEl.disabled=e),this.filteredLabelSlottedNodes?.length&&this.filteredLabelSlottedNodes.forEach(e=>e.disabled=this.disabled)}toggleUserValidityState(){R(this.elementInternals,`user-invalid`,!this.validity.valid),R(this.elementInternals,`user-valid`,this.validity.valid)}maybeCreateAutoSizerEl(){if(!CSS.supports(`field-sizing: content`)){if(!this.autoResize){this.autoSizerEl?.remove(),this.autoSizerObserver?.disconnect();return}this.autoSizerEl||(this.autoSizerEl=document.createElement(`div`),this.autoSizerEl.classList.add(`auto-sizer`),this.autoSizerEl.ariaHidden=`true`),this.rootEl?.prepend(this.autoSizerEl),this.autoSizerObserver||=new ResizeObserver((e,t)=>{let n=window.getComputedStyle(this).writingMode.startsWith(`horizontal`)?`height`:`width`;this.style.getPropertyValue(n)!==``&&(this.autoSizerEl?.remove(),t.disconnect())}),this.autoSizerObserver.observe(this)}}handleControlInput(){this.autoResize&&this.autoSizerEl&&(this.autoSizerEl.textContent=this.value+` `),this.setFormValue(this.value),this.setValidity()}handleControlChange(){this.toggleUserValidityState(),this.$emit(`change`)}handleControlSelect(){this.$emit(`select`)}};e([g],W.prototype,`controlEl`,void 0),e([g],W.prototype,`defaultSlottedNodes`,void 0),e([g],W.prototype,`labelSlottedNodes`,void 0),e([v],W.prototype,`autocomplete`,void 0),e([v({attribute:`auto-resize`,mode:`boolean`})],W.prototype,`autoResize`,void 0),e([v({attribute:`dirname`})],W.prototype,`dirName`,void 0),e([v({mode:`boolean`})],W.prototype,`disabled`,void 0),e([v({attribute:`display-shadow`,mode:`boolean`})],W.prototype,`displayShadow`,void 0),e([v({attribute:`form`})],W.prototype,`initialForm`,void 0),e([v({attribute:`maxlength`,converter:Te})],W.prototype,`maxLength`,void 0),e([v({attribute:`minlength`,converter:Te})],W.prototype,`minLength`,void 0),e([v],W.prototype,`name`,void 0),e([v],W.prototype,`placeholder`,void 0),e([v({attribute:`readonly`,mode:`boolean`})],W.prototype,`readOnly`,void 0),e([v({mode:`boolean`})],W.prototype,`required`,void 0),e([v({mode:`fromView`})],W.prototype,`resize`,void 0),e([v({mode:`boolean`})],W.prototype,`spellcheck`,void 0);var vs=class extends W{constructor(){super(...arguments),this.appearance=us.outline,this.block=!1}labelSlottedNodesChanged(){super.labelSlottedNodesChanged(),this.labelSlottedNodes.forEach(e=>{e.size=this.size})}handleChange(e,t){switch(t){case`size`:this.labelSlottedNodes.forEach(e=>{e.size=this.size});break}}connectedCallback(){super.connectedCallback(),h.getNotifier(this).subscribe(this,`size`)}disconnectedCallback(){super.disconnectedCallback(),h.getNotifier(this).unsubscribe(this,`size`)}};e([v({mode:`fromView`})],vs.prototype,`appearance`,void 0),e([v({mode:`boolean`})],vs.prototype,`block`,void 0),e([v],vs.prototype,`size`,void 0);var ys=`adoptedStyleSheets`in document,bs=`CSSScopeRule`in window,xs=new Map,Ss=new Map,Cs=new Map,ws=new Map,Ts=new CSSStyleSheet;function Es(e,t=document){if(!(!t||!Os(t))){if(!ys||t instanceof HTMLElement&&!t.shadowRoot&&!bs){Ns(e,t===document?document.documentElement:t);return}[document,document.documentElement,document.body].includes(t)?ks(e):As(e,t)}}function Ds(e){if(!xs.has(e)){let t=[];for(let[n,r]of Object.entries(e))t.push(`--${n}:${r.toString()};`);xs.set(e,t.join(``))}return xs.get(e)}function Os(e){return[document,document.documentElement].includes(e)||e instanceof HTMLElement&&!!e.closest(`body`)}function ks(e){if(e===null){document.adoptedStyleSheets.includes(Ts)&&Ts.replaceSync(``);return}Ts.replaceSync(`
    html {
      ${Ds(e)}
    }
  `),document.adoptedStyleSheets.includes(Ts)||document.adoptedStyleSheets.push(Ts)}function As(e,t){if(e===null){t.shadowRoot&&Cs.has(t)?Cs.get(t).replaceSync(``):(delete t.dataset.fluentTheme,Is(t));return}t.shadowRoot?js(t).replaceSync(`
      :host {
        ${Ds(e)}
      }
    `):(t.dataset.fluentTheme=Ms(e),Is(t))}function js(e){if(!Cs.has(e)){let t=new CSSStyleSheet;Cs.set(e,t),e.shadowRoot?.adoptedStyleSheets.push(t)}return Cs.get(e)}function Ms(e){if(!Ss.has(e)){let t=bo(`fluent-theme-`),n=new CSSStyleSheet;Ss.set(e,t),n.replaceSync(`
      @scope ([data-fluent-theme="${t}"]) {
        :scope {
          ${Ds(e)}
        }
      }
    `),document.adoptedStyleSheets.push(n)}return Ss.get(e)}function Ns(e,t){let n;if(e===null){if(!ws.has(t))return;n=ws.get(t)}else ws.set(t,e),n=e;for(let[r,i]of Object.entries(n))e===null?t.style.removeProperty(`--${r}`):t.style.setProperty(`--${r}`,i.toString())}var{userAgent:Ps}=navigator,Fs=/\bAppleWebKit\/[\d+\.]+\b/.test(Ps);function Is(e){if(!Fs)return;let t=`visibility`,n=e.style.getPropertyValue(t);e.style.setProperty(t,`hidden`),m.process(),e.style.setProperty(t,n)}var G={2:`#050505`,4:`#0a0a0a`,6:`#0f0f0f`,8:`#141414`,10:`#1a1a1a`,12:`#1f1f1f`,14:`#242424`,16:`#292929`,18:`#2e2e2e`,20:`#333333`,22:`#383838`,24:`#3d3d3d`,26:`#424242`,28:`#474747`,30:`#4d4d4d`,32:`#525252`,34:`#575757`,36:`#5c5c5c`,38:`#616161`,40:`#666666`,42:`#6b6b6b`,44:`#707070`,46:`#757575`,48:`#7a7a7a`,50:`#808080`,52:`#858585`,54:`#8a8a8a`,56:`#8f8f8f`,58:`#949494`,60:`#999999`,62:`#9e9e9e`,64:`#a3a3a3`,66:`#a8a8a8`,68:`#adadad`,70:`#b3b3b3`,72:`#b8b8b8`,74:`#bdbdbd`,76:`#c2c2c2`,78:`#c7c7c7`,80:`#cccccc`,82:`#d1d1d1`,84:`#d6d6d6`,86:`#dbdbdb`,88:`#e0e0e0`,90:`#e6e6e6`,92:`#ebebeb`,94:`#f0f0f0`,96:`#f5f5f5`,98:`#fafafa`,99:`#fcfcfc`},K={5:`rgba(255, 255, 255, 0.05)`,10:`rgba(255, 255, 255, 0.1)`,20:`rgba(255, 255, 255, 0.2)`,30:`rgba(255, 255, 255, 0.3)`,40:`rgba(255, 255, 255, 0.4)`,50:`rgba(255, 255, 255, 0.5)`,60:`rgba(255, 255, 255, 0.6)`,70:`rgba(255, 255, 255, 0.7)`,80:`rgba(255, 255, 255, 0.8)`,90:`rgba(255, 255, 255, 0.9)`},q={5:`rgba(0, 0, 0, 0.05)`,10:`rgba(0, 0, 0, 0.1)`,20:`rgba(0, 0, 0, 0.2)`,30:`rgba(0, 0, 0, 0.3)`,40:`rgba(0, 0, 0, 0.4)`,50:`rgba(0, 0, 0, 0.5)`,60:`rgba(0, 0, 0, 0.6)`,70:`rgba(0, 0, 0, 0.7)`,80:`rgba(0, 0, 0, 0.8)`,90:`rgba(0, 0, 0, 0.9)`},Ls={5:`rgba(26, 26, 26, 0.05)`,10:`rgba(26, 26, 26, 0.1)`,20:`rgba(26, 26, 26, 0.2)`,30:`rgba(26, 26, 26, 0.3)`,40:`rgba(26, 26, 26, 0.4)`,50:`rgba(26, 26, 26, 0.5)`,60:`rgba(26, 26, 26, 0.6)`,70:`rgba(26, 26, 26, 0.7)`,80:`rgba(26, 26, 26, 0.8)`,90:`rgba(26, 26, 26, 0.9)`},Rs={5:`rgba(31, 31, 31, 0.05)`,10:`rgba(31, 31, 31, 0.1)`,20:`rgba(31, 31, 31, 0.2)`,30:`rgba(31, 31, 31, 0.3)`,40:`rgba(31, 31, 31, 0.4)`,50:`rgba(31, 31, 31, 0.5)`,60:`rgba(31, 31, 31, 0.6)`,70:`rgba(31, 31, 31, 0.7)`,80:`rgba(31, 31, 31, 0.8)`,90:`rgba(31, 31, 31, 0.9)`},zs={5:`rgba(36, 36, 36, 0.05)`,10:`rgba(36, 36, 36, 0.1)`,20:`rgba(36, 36, 36, 0.2)`,30:`rgba(36, 36, 36, 0.3)`,40:`rgba(36, 36, 36, 0.4)`,50:`rgba(36, 36, 36, 0.5)`,60:`rgba(36, 36, 36, 0.6)`,70:`rgba(36, 36, 36, 0.7)`,80:`rgba(36, 36, 36, 0.8)`,90:`rgba(36, 36, 36, 0.9)`},J=`#ffffff`,Bs=`#000000`,Vs={shade50:`#130204`,shade40:`#230308`,shade30:`#420610`,shade20:`#590815`,shade10:`#690a19`,primary:`#750b1c`,tint10:`#861b2c`,tint20:`#962f3f`,tint30:`#ac4f5e`,tint40:`#d69ca5`,tint50:`#e9c7cd`,tint60:`#f9f0f2`},Hs={shade50:`#200205`,shade40:`#3b0509`,shade30:`#6e0811`,shade20:`#960b18`,shade10:`#b10e1c`,primary:`#c50f1f`,tint10:`#cc2635`,tint20:`#d33f4c`,tint30:`#dc626d`,tint40:`#eeacb2`,tint50:`#f6d1d5`,tint60:`#fdf3f4`},Us={shade50:`#210809`,shade40:`#3f1011`,shade30:`#751d1f`,shade20:`#9f282b`,shade10:`#bc2f32`,primary:`#d13438`,tint10:`#d7494c`,tint20:`#dc5e62`,tint30:`#e37d80`,tint40:`#f1bbbc`,tint50:`#f8dadb`,tint60:`#fdf6f6`},Ws={shade50:`#230900`,shade40:`#411200`,shade30:`#7a2101`,shade20:`#a62d01`,shade10:`#c43501`,primary:`#da3b01`,tint10:`#de501c`,tint20:`#e36537`,tint30:`#e9835e`,tint40:`#f4bfab`,tint50:`#f9dcd1`,tint60:`#fdf6f3`},Gs={shade50:`#200d03`,shade40:`#3d1805`,shade30:`#712d09`,shade20:`#9a3d0c`,shade10:`#b6480e`,primary:`#ca5010`,tint10:`#d06228`,tint20:`#d77440`,tint30:`#df8e64`,tint40:`#efc4ad`,tint50:`#f7dfd2`,tint60:`#fdf7f4`},Ks={shade50:`#271002`,shade40:`#4a1e04`,shade30:`#8a3707`,shade20:`#bc4b09`,shade10:`#de590b`,primary:`#f7630c`,tint10:`#f87528`,tint20:`#f98845`,tint30:`#faa06b`,tint40:`#fdcfb4`,tint50:`#fee5d7`,tint60:`#fff9f5`},qs={shade50:`#291600`,shade40:`#4d2a00`,shade30:`#8f4e00`,shade20:`#c26a00`,shade10:`#e67e00`,primary:`#ff8c00`,tint10:`#ff9a1f`,tint20:`#ffa83d`,tint30:`#ffba66`,tint40:`#ffddb3`,tint50:`#ffedd6`,tint60:`#fffaf5`},Js={shade50:`#251a00`,shade40:`#463100`,shade30:`#835b00`,shade20:`#b27c00`,shade10:`#d39300`,primary:`#eaa300`,tint10:`#edad1c`,tint20:`#efb839`,tint30:`#f2c661`,tint40:`#f9e2ae`,tint50:`#fcefd3`,tint60:`#fefbf4`},Ys={shade50:`#282400`,shade40:`#4c4400`,shade30:`#817400`,shade20:`#c0ad00`,shade10:`#e4cc00`,primary:`#fde300`,tint10:`#fde61e`,tint20:`#fdea3d`,tint30:`#feee66`,tint40:`#fef7b2`,tint50:`#fffad6`,tint60:`#fffef5`},Xs={shade50:`#1f1900`,shade40:`#3a2f00`,shade30:`#6c5700`,shade20:`#937700`,shade10:`#ae8c00`,primary:`#c19c00`,tint10:`#c8a718`,tint20:`#d0b232`,tint30:`#dac157`,tint40:`#ecdfa5`,tint50:`#f5eece`,tint60:`#fdfbf2`},Zs={shade50:`#181202`,shade40:`#2e2103`,shade30:`#553e06`,shade20:`#745408`,shade10:`#89640a`,primary:`#986f0b`,tint10:`#a47d1e`,tint20:`#b18c34`,tint30:`#c1a256`,tint40:`#e0cea2`,tint50:`#efe4cb`,tint60:`#fbf8f2`},Qs={shade50:`#170e07`,shade40:`#2b1a0e`,shade30:`#50301a`,shade20:`#6c4123`,shade10:`#804d29`,primary:`#8e562e`,tint10:`#9c663f`,tint20:`#a97652`,tint30:`#bb8f6f`,tint40:`#ddc3b0`,tint50:`#edded3`,tint60:`#faf7f4`},$s={shade50:`#0c1501`,shade40:`#162702`,shade30:`#294903`,shade20:`#376304`,shade10:`#427505`,primary:`#498205`,tint10:`#599116`,tint20:`#6ba02b`,tint30:`#85b44c`,tint40:`#bdd99b`,tint50:`#dbebc7`,tint60:`#f6faf0`},ec={shade50:`#002111`,shade40:`#003d20`,shade30:`#00723b`,shade20:`#009b51`,shade10:`#00b85f`,primary:`#00cc6a`,tint10:`#19d279`,tint20:`#34d889`,tint30:`#5ae0a0`,tint40:`#a8f0cd`,tint50:`#cff7e4`,tint60:`#f3fdf8`},tc={shade50:`#031a02`,shade40:`#063004`,shade30:`#0b5a08`,shade20:`#0e7a0b`,shade10:`#11910d`,primary:`#13a10e`,tint10:`#27ac22`,tint20:`#3db838`,tint30:`#5ec75a`,tint40:`#a7e3a5`,tint50:`#cef0cd`,tint60:`#f2fbf2`},nc={shade50:`#031403`,shade40:`#052505`,shade30:`#094509`,shade20:`#0c5e0c`,shade10:`#0e700e`,primary:`#107c10`,tint10:`#218c21`,tint20:`#359b35`,tint30:`#54b054`,tint40:`#9fd89f`,tint50:`#c9eac9`,tint60:`#f1faf1`},rc={shade50:`#021102`,shade40:`#032003`,shade30:`#063b06`,shade20:`#085108`,shade10:`#0a5f0a`,primary:`#0b6a0b`,tint10:`#1a7c1a`,tint20:`#2d8e2d`,tint30:`#4da64d`,tint40:`#9ad29a`,tint50:`#c6e7c6`,tint60:`#f0f9f0`},ic={shade50:`#001d1f`,shade40:`#00373a`,shade30:`#00666d`,shade20:`#008b94`,shade10:`#00a5af`,primary:`#00b7c3`,tint10:`#18bfca`,tint20:`#32c8d1`,tint30:`#58d3db`,tint40:`#a6e9ed`,tint50:`#cef3f5`,tint60:`#f2fcfd`},ac={shade50:`#001516`,shade40:`#012728`,shade30:`#02494c`,shade20:`#026467`,shade10:`#037679`,primary:`#038387`,tint10:`#159195`,tint20:`#2aa0a4`,tint30:`#4cb4b7`,tint40:`#9bd9db`,tint50:`#c7ebec`,tint60:`#f0fafa`},oc={shade50:`#000f12`,shade40:`#001b22`,shade30:`#00333f`,shade20:`#004555`,shade10:`#005265`,primary:`#005b70`,tint10:`#0f6c81`,tint20:`#237d92`,tint30:`#4496a9`,tint40:`#94c8d4`,tint50:`#c3e1e8`,tint60:`#eff7f9`},sc={shade50:`#001322`,shade40:`#002440`,shade30:`#004377`,shade20:`#005ba1`,shade10:`#006cbf`,primary:`#0078d4`,tint10:`#1a86d9`,tint20:`#3595de`,tint30:`#5caae5`,tint40:`#a9d3f2`,tint50:`#d0e7f8`,tint60:`#f3f9fd`},cc={shade50:`#000c16`,shade40:`#00172a`,shade30:`#002c4e`,shade20:`#003b6a`,shade10:`#00467e`,primary:`#004e8c`,tint10:`#125e9a`,tint20:`#286fa8`,tint30:`#4a89ba`,tint40:`#9abfdc`,tint50:`#c7dced`,tint60:`#f0f6fa`},lc={shade50:`#0d1126`,shade40:`#182047`,shade30:`#2c3c85`,shade20:`#3c51b4`,shade10:`#4760d5`,primary:`#4f6bed`,tint10:`#637cef`,tint20:`#778df1`,tint30:`#93a4f4`,tint40:`#c8d1fa`,tint50:`#e1e6fc`,tint60:`#f7f9fe`},uc={shade50:`#00061d`,shade40:`#000c36`,shade30:`#001665`,shade20:`#001e89`,shade10:`#0023a2`,primary:`#0027b4`,tint10:`#173bbd`,tint20:`#3050c6`,tint30:`#546fd2`,tint40:`#a3b2e8`,tint50:`#ccd5f3`,tint60:`#f2f4fc`},dc={shade50:`#120f25`,shade40:`#221d46`,shade30:`#3f3682`,shade20:`#5649b0`,shade10:`#6656d1`,primary:`#7160e8`,tint10:`#8172eb`,tint20:`#9184ee`,tint30:`#a79cf1`,tint40:`#d2ccf8`,tint50:`#e7e4fb`,tint60:`#f9f8fe`},fc={shade50:`#0f0717`,shade40:`#1c0e2b`,shade30:`#341a51`,shade20:`#46236e`,shade10:`#532982`,primary:`#5c2e91`,tint10:`#6b3f9e`,tint20:`#7c52ab`,tint30:`#9470bd`,tint40:`#c6b1de`,tint50:`#e0d3ed`,tint60:`#f7f4fb`},pc={shade50:`#160418`,shade40:`#29072e`,shade30:`#4c0d55`,shade20:`#671174`,shade10:`#7a1589`,primary:`#881798`,tint10:`#952aa4`,tint20:`#a33fb1`,tint30:`#b55fc1`,tint40:`#d9a7e0`,tint50:`#eaceef`,tint60:`#faf2fb`},mc={shade50:`#1f091d`,shade40:`#3a1136`,shade30:`#6d2064`,shade20:`#932b88`,shade10:`#af33a1`,primary:`#c239b3`,tint10:`#c94cbc`,tint20:`#d161c4`,tint30:`#da7ed0`,tint40:`#edbbe7`,tint50:`#f5daf2`,tint60:`#fdf5fc`},hc={shade50:`#1c0b1f`,shade40:`#35153a`,shade30:`#63276d`,shade20:`#863593`,shade10:`#9f3faf`,primary:`#b146c2`,tint10:`#ba58c9`,tint20:`#c36bd1`,tint30:`#cf87da`,tint40:`#e6bfed`,tint50:`#f2dcf5`,tint60:`#fcf6fd`},gc={shade50:`#24091b`,shade40:`#441232`,shade30:`#80215d`,shade20:`#ad2d7e`,shade10:`#cd3595`,primary:`#e43ba6`,tint10:`#e750b0`,tint20:`#ea66ba`,tint30:`#ef85c8`,tint40:`#f7c0e3`,tint50:`#fbddf0`,tint60:`#fef6fb`},_c={shade50:`#1f0013`,shade40:`#390024`,shade30:`#6b0043`,shade20:`#91005a`,shade10:`#ac006b`,primary:`#bf0077`,tint10:`#c71885`,tint20:`#ce3293`,tint30:`#d957a8`,tint40:`#eca5d1`,tint50:`#f5cee6`,tint60:`#fcf2f9`},vc={shade50:`#13000c`,shade40:`#240017`,shade30:`#43002b`,shade20:`#5a003b`,shade10:`#6b0045`,primary:`#77004d`,tint10:`#87105d`,tint20:`#98246f`,tint30:`#ad4589`,tint40:`#d696c0`,tint50:`#e9c4dc`,tint60:`#faf0f6`},yc={shade50:`#141313`,shade40:`#252323`,shade30:`#444241`,shade20:`#5d5958`,shade10:`#6e6968`,primary:`#7a7574`,tint10:`#8a8584`,tint20:`#9a9594`,tint30:`#afabaa`,tint40:`#d7d4d4`,tint50:`#eae8e8`,tint60:`#faf9f9`},bc={shade50:`#0f0e0e`,shade40:`#1c1b1a`,shade30:`#343231`,shade20:`#474443`,shade10:`#54514f`,primary:`#5d5a58`,tint10:`#706d6b`,tint20:`#84817e`,tint30:`#9e9b99`,tint40:`#cecccb`,tint50:`#e5e4e3`,tint60:`#f8f8f8`},xc={shade50:`#111314`,shade40:`#1f2426`,shade30:`#3b4447`,shade20:`#505c60`,shade10:`#5f6d71`,primary:`#69797e`,tint10:`#79898d`,tint20:`#89989d`,tint30:`#a0adb2`,tint40:`#cdd6d8`,tint50:`#e4e9ea`,tint60:`#f8f9fa`},Sc={shade50:`#090a0b`,shade40:`#111315`,shade30:`#202427`,shade20:`#2b3135`,shade10:`#333a3f`,primary:`#394146`,tint10:`#4d565c`,tint20:`#626c72`,tint30:`#808a90`,tint40:`#bcc3c7`,tint50:`#dbdfe1`,tint60:`#f6f7f8`},Y={red:Us,green:nc,darkOrange:Ws,yellow:Ys,berry:mc,lightGreen:tc,marigold:Js},Cc={darkRed:Vs,cranberry:Hs,pumpkin:Gs,peach:qs,gold:Xs,brass:Zs,brown:Qs,forest:$s,seafoam:ec,darkGreen:rc,lightTeal:ic,teal:ac,steel:oc,blue:sc,royalBlue:cc,cornflower:lc,navy:uc,lavender:dc,purple:fc,grape:pc,lilac:hc,pink:gc,magenta:_c,plum:vc,beige:yc,mink:bc,platinum:xc,anchor:Sc},X={cranberry:Hs,green:nc,orange:Ks},wc=[`red`,`green`,`darkOrange`,`yellow`,`berry`,`lightGreen`,`marigold`],Tc=`darkRed.cranberry.pumpkin.peach.gold.brass.brown.forest.seafoam.darkGreen.lightTeal.teal.steel.blue.royalBlue.cornflower.navy.lavender.purple.grape.lilac.pink.magenta.plum.beige.mink.platinum.anchor`.split(`.`),Z={success:`green`,warning:`orange`,danger:`cranberry`},Ec=wc.reduce((e,t)=>{let n=t.slice(0,1).toUpperCase()+t.slice(1),r={[`colorPalette${n}Background1`]:Y[t].tint60,[`colorPalette${n}Background2`]:Y[t].tint40,[`colorPalette${n}Background3`]:Y[t].primary,[`colorPalette${n}Foreground1`]:Y[t].shade10,[`colorPalette${n}Foreground2`]:Y[t].shade30,[`colorPalette${n}Foreground3`]:Y[t].primary,[`colorPalette${n}BorderActive`]:Y[t].primary,[`colorPalette${n}Border1`]:Y[t].tint40,[`colorPalette${n}Border2`]:Y[t].primary};return Object.assign(e,r)},{});Ec.colorPaletteYellowForeground1=Y.yellow.shade30,Ec.colorPaletteRedForegroundInverted=Y.red.tint20,Ec.colorPaletteGreenForegroundInverted=Y.green.tint20,Ec.colorPaletteYellowForegroundInverted=Y.yellow.tint40;var Dc=Tc.reduce((e,t)=>{let n=t.slice(0,1).toUpperCase()+t.slice(1),r={[`colorPalette${n}Background2`]:Cc[t].tint40,[`colorPalette${n}Foreground2`]:Cc[t].shade30,[`colorPalette${n}BorderActive`]:Cc[t].primary};return Object.assign(e,r)},{}),Oc={...Ec,...Dc},kc=Object.entries(Z).reduce((e,[t,n])=>{let r=t.slice(0,1).toUpperCase()+t.slice(1),i={[`colorStatus${r}Background1`]:X[n].tint60,[`colorStatus${r}Background2`]:X[n].tint40,[`colorStatus${r}Background3`]:X[n].primary,[`colorStatus${r}Foreground1`]:X[n].shade10,[`colorStatus${r}Foreground2`]:X[n].shade30,[`colorStatus${r}Foreground3`]:X[n].primary,[`colorStatus${r}ForegroundInverted`]:X[n].tint30,[`colorStatus${r}BorderActive`]:X[n].primary,[`colorStatus${r}Border1`]:X[n].tint40,[`colorStatus${r}Border2`]:X[n].primary};return Object.assign(e,i)},{});kc.colorStatusDangerBackground3Hover=X[Z.danger].shade10,kc.colorStatusDangerBackground3Pressed=X[Z.danger].shade20,kc.colorStatusWarningForeground1=X[Z.warning].shade20,kc.colorStatusWarningForeground3=X[Z.warning].shade20,kc.colorStatusWarningBorder2=X[Z.warning].shade20;var Ac=e=>({colorNeutralForeground1:G[14],colorNeutralForeground1Hover:G[14],colorNeutralForeground1Pressed:G[14],colorNeutralForeground1Selected:G[14],colorNeutralForeground2:G[26],colorNeutralForeground2Hover:G[14],colorNeutralForeground2Pressed:G[14],colorNeutralForeground2Selected:G[14],colorNeutralForeground2BrandHover:e[80],colorNeutralForeground2BrandPressed:e[70],colorNeutralForeground2BrandSelected:e[80],colorNeutralForeground3:G[38],colorNeutralForeground3Hover:G[26],colorNeutralForeground3Pressed:G[26],colorNeutralForeground3Selected:G[26],colorNeutralForeground3BrandHover:e[80],colorNeutralForeground3BrandPressed:e[70],colorNeutralForeground3BrandSelected:e[80],colorNeutralForeground4:G[44],colorNeutralForeground5:G[38],colorNeutralForeground5Hover:G[14],colorNeutralForeground5Pressed:G[14],colorNeutralForeground5Selected:G[14],colorNeutralForegroundDisabled:G[74],colorNeutralForegroundInvertedDisabled:K[40],colorBrandForegroundLink:e[70],colorBrandForegroundLinkHover:e[60],colorBrandForegroundLinkPressed:e[40],colorBrandForegroundLinkSelected:e[70],colorNeutralForeground2Link:G[26],colorNeutralForeground2LinkHover:G[14],colorNeutralForeground2LinkPressed:G[14],colorNeutralForeground2LinkSelected:G[14],colorCompoundBrandForeground1:e[80],colorCompoundBrandForeground1Hover:e[70],colorCompoundBrandForeground1Pressed:e[60],colorBrandForeground1:e[80],colorBrandForeground2:e[70],colorBrandForeground2Hover:e[60],colorBrandForeground2Pressed:e[30],colorNeutralForeground1Static:G[14],colorNeutralForegroundStaticInverted:J,colorNeutralForegroundInverted:J,colorNeutralForegroundInvertedHover:J,colorNeutralForegroundInvertedPressed:J,colorNeutralForegroundInvertedSelected:J,colorNeutralForegroundInverted2:J,colorNeutralForegroundOnBrand:J,colorNeutralForegroundInvertedLink:J,colorNeutralForegroundInvertedLinkHover:J,colorNeutralForegroundInvertedLinkPressed:J,colorNeutralForegroundInvertedLinkSelected:J,colorBrandForegroundInverted:e[100],colorBrandForegroundInvertedHover:e[110],colorBrandForegroundInvertedPressed:e[100],colorBrandForegroundOnLight:e[80],colorBrandForegroundOnLightHover:e[70],colorBrandForegroundOnLightPressed:e[50],colorBrandForegroundOnLightSelected:e[60],colorNeutralBackground1:J,colorNeutralBackground1Hover:G[96],colorNeutralBackground1Pressed:G[88],colorNeutralBackground1Selected:G[92],colorNeutralBackground2:G[98],colorNeutralBackground2Hover:G[94],colorNeutralBackground2Pressed:G[86],colorNeutralBackground2Selected:G[90],colorNeutralBackground3:G[96],colorNeutralBackground3Hover:G[92],colorNeutralBackground3Pressed:G[84],colorNeutralBackground3Selected:G[88],colorNeutralBackground4:G[94],colorNeutralBackground4Hover:G[98],colorNeutralBackground4Pressed:G[96],colorNeutralBackground4Selected:J,colorNeutralBackground5:G[92],colorNeutralBackground5Hover:G[96],colorNeutralBackground5Pressed:G[94],colorNeutralBackground5Selected:G[98],colorNeutralBackground6:G[90],colorNeutralBackground7:`#00000000`,colorNeutralBackground7Hover:G[92],colorNeutralBackground7Pressed:G[84],colorNeutralBackground7Selected:`#00000000`,colorNeutralBackground8:G[99],colorNeutralBackgroundInverted:G[16],colorNeutralBackgroundInvertedHover:G[24],colorNeutralBackgroundInvertedPressed:G[12],colorNeutralBackgroundInvertedSelected:G[22],colorNeutralBackgroundStatic:G[20],colorNeutralBackgroundAlpha:K[50],colorNeutralBackgroundAlpha2:K[80],colorSubtleBackground:`transparent`,colorSubtleBackgroundHover:G[96],colorSubtleBackgroundPressed:G[88],colorSubtleBackgroundSelected:G[92],colorSubtleBackgroundLightAlphaHover:K[70],colorSubtleBackgroundLightAlphaPressed:K[50],colorSubtleBackgroundLightAlphaSelected:`transparent`,colorSubtleBackgroundInverted:`transparent`,colorSubtleBackgroundInvertedHover:q[10],colorSubtleBackgroundInvertedPressed:q[30],colorSubtleBackgroundInvertedSelected:q[20],colorTransparentBackground:`transparent`,colorTransparentBackgroundHover:`transparent`,colorTransparentBackgroundPressed:`transparent`,colorTransparentBackgroundSelected:`transparent`,colorNeutralBackgroundDisabled:G[94],colorNeutralBackgroundDisabled2:J,colorNeutralBackgroundInvertedDisabled:K[10],colorNeutralStencil1:G[90],colorNeutralStencil2:G[98],colorNeutralStencil1Alpha:q[10],colorNeutralStencil2Alpha:q[5],colorBackgroundOverlay:q[40],colorScrollbarOverlay:q[50],colorBrandBackground:e[80],colorBrandBackgroundHover:e[70],colorBrandBackgroundPressed:e[40],colorBrandBackgroundSelected:e[60],colorCompoundBrandBackground:e[80],colorCompoundBrandBackgroundHover:e[70],colorCompoundBrandBackgroundPressed:e[60],colorBrandBackgroundStatic:e[80],colorBrandBackground2:e[160],colorBrandBackground2Hover:e[150],colorBrandBackground2Pressed:e[130],colorBrandBackground3Static:e[60],colorBrandBackground4Static:e[40],colorBrandBackgroundInverted:J,colorBrandBackgroundInvertedHover:e[160],colorBrandBackgroundInvertedPressed:e[140],colorBrandBackgroundInvertedSelected:e[150],colorNeutralCardBackground:G[98],colorNeutralCardBackgroundHover:J,colorNeutralCardBackgroundPressed:G[96],colorNeutralCardBackgroundSelected:G[92],colorNeutralCardBackgroundDisabled:G[94],colorNeutralStrokeAccessible:G[38],colorNeutralStrokeAccessibleHover:G[34],colorNeutralStrokeAccessiblePressed:G[30],colorNeutralStrokeAccessibleSelected:e[80],colorNeutralStroke1:G[82],colorNeutralStroke1Hover:G[78],colorNeutralStroke1Pressed:G[70],colorNeutralStroke1Selected:G[74],colorNeutralStroke2:G[88],colorNeutralStroke3:G[94],colorNeutralStroke4:G[92],colorNeutralStroke4Hover:G[88],colorNeutralStroke4Pressed:G[84],colorNeutralStroke4Selected:G[92],colorNeutralStrokeSubtle:G[88],colorNeutralStrokeOnBrand:J,colorNeutralStrokeOnBrand2:J,colorNeutralStrokeOnBrand2Hover:J,colorNeutralStrokeOnBrand2Pressed:J,colorNeutralStrokeOnBrand2Selected:J,colorBrandStroke1:e[80],colorBrandStroke2:e[140],colorBrandStroke2Hover:e[120],colorBrandStroke2Pressed:e[80],colorBrandStroke2Contrast:e[140],colorCompoundBrandStroke:e[80],colorCompoundBrandStrokeHover:e[70],colorCompoundBrandStrokePressed:e[60],colorNeutralStrokeDisabled:G[88],colorNeutralStrokeDisabled2:G[92],colorNeutralStrokeInvertedDisabled:K[40],colorTransparentStroke:`transparent`,colorTransparentStrokeInteractive:`transparent`,colorTransparentStrokeDisabled:`transparent`,colorNeutralStrokeAlpha:q[5],colorNeutralStrokeAlpha2:K[20],colorStrokeFocus1:J,colorStrokeFocus2:Bs,colorNeutralShadowAmbient:`rgba(0,0,0,0.12)`,colorNeutralShadowKey:`rgba(0,0,0,0.14)`,colorNeutralShadowAmbientLighter:`rgba(0,0,0,0.06)`,colorNeutralShadowKeyLighter:`rgba(0,0,0,0.07)`,colorNeutralShadowAmbientDarker:`rgba(0,0,0,0.20)`,colorNeutralShadowKeyDarker:`rgba(0,0,0,0.24)`,colorBrandShadowAmbient:`rgba(0,0,0,0.30)`,colorBrandShadowKey:`rgba(0,0,0,0.25)`}),jc={borderRadiusNone:`0`,borderRadiusSmall:`2px`,borderRadiusMedium:`4px`,borderRadiusLarge:`6px`,borderRadiusXLarge:`8px`,borderRadius2XLarge:`12px`,borderRadius3XLarge:`16px`,borderRadius4XLarge:`24px`,borderRadius5XLarge:`32px`,borderRadius6XLarge:`40px`,borderRadiusCircular:`10000px`},Mc={curveAccelerateMax:`cubic-bezier(0.9,0.1,1,0.2)`,curveAccelerateMid:`cubic-bezier(1,0,1,1)`,curveAccelerateMin:`cubic-bezier(0.8,0,0.78,1)`,curveDecelerateMax:`cubic-bezier(0.1,0.9,0.2,1)`,curveDecelerateMid:`cubic-bezier(0,0,0,1)`,curveDecelerateMin:`cubic-bezier(0.33,0,0.1,1)`,curveEasyEaseMax:`cubic-bezier(0.8,0,0.2,1)`,curveEasyEase:`cubic-bezier(0.33,0,0.67,1)`,curveLinear:`cubic-bezier(0,0,1,1)`},Nc={durationUltraFast:`50ms`,durationFaster:`100ms`,durationFast:`150ms`,durationNormal:`200ms`,durationGentle:`250ms`,durationSlow:`300ms`,durationSlower:`400ms`,durationUltraSlow:`500ms`},Pc={fontSizeBase100:`10px`,fontSizeBase200:`12px`,fontSizeBase300:`14px`,fontSizeBase400:`16px`,fontSizeBase500:`20px`,fontSizeBase600:`24px`,fontSizeHero700:`28px`,fontSizeHero800:`32px`,fontSizeHero900:`40px`,fontSizeHero1000:`68px`},Fc={lineHeightBase100:`14px`,lineHeightBase200:`16px`,lineHeightBase300:`20px`,lineHeightBase400:`22px`,lineHeightBase500:`28px`,lineHeightBase600:`32px`,lineHeightHero700:`36px`,lineHeightHero800:`40px`,lineHeightHero900:`52px`,lineHeightHero1000:`92px`},Ic={fontWeightRegular:400,fontWeightMedium:500,fontWeightSemibold:600,fontWeightBold:700},Lc={fontFamilyBase:`'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif`,fontFamilyMonospace:`Consolas, 'Courier New', Courier, monospace`,fontFamilyNumeric:`Bahnschrift, 'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif`},Q={none:`0`,xxs:`2px`,xs:`4px`,sNudge:`6px`,s:`8px`,mNudge:`10px`,m:`12px`,l:`16px`,xl:`20px`,xxl:`24px`,xxxl:`32px`},Rc={spacingHorizontalNone:Q.none,spacingHorizontalXXS:Q.xxs,spacingHorizontalXS:Q.xs,spacingHorizontalSNudge:Q.sNudge,spacingHorizontalS:Q.s,spacingHorizontalMNudge:Q.mNudge,spacingHorizontalM:Q.m,spacingHorizontalL:Q.l,spacingHorizontalXL:Q.xl,spacingHorizontalXXL:Q.xxl,spacingHorizontalXXXL:Q.xxxl},zc={spacingVerticalNone:Q.none,spacingVerticalXXS:Q.xxs,spacingVerticalXS:Q.xs,spacingVerticalSNudge:Q.sNudge,spacingVerticalS:Q.s,spacingVerticalMNudge:Q.mNudge,spacingVerticalM:Q.m,spacingVerticalL:Q.l,spacingVerticalXL:Q.xl,spacingVerticalXXL:Q.xxl,spacingVerticalXXXL:Q.xxxl},Bc={strokeWidthThin:`1px`,strokeWidthThick:`2px`,strokeWidthThicker:`3px`,strokeWidthThickest:`4px`};function Vc(e,t,n=``){return{[`shadow2${n}`]:`0 0 2px ${e}, 0 1px 2px ${t}`,[`shadow4${n}`]:`0 0 2px ${e}, 0 2px 4px ${t}`,[`shadow8${n}`]:`0 0 2px ${e}, 0 4px 8px ${t}`,[`shadow16${n}`]:`0 0 2px ${e}, 0 8px 16px ${t}`,[`shadow28${n}`]:`0 0 8px ${e}, 0 14px 28px ${t}`,[`shadow64${n}`]:`0 0 8px ${e}, 0 32px 64px ${t}`}}var Hc=e=>{let t=Ac(e);return{...jc,...Pc,...Fc,...Lc,...Ic,...Bc,...Rc,...zc,...Nc,...Mc,...t,...Oc,...kc,...Vc(t.colorNeutralShadowAmbient,t.colorNeutralShadowKey),...Vc(t.colorBrandShadowAmbient,t.colorBrandShadowKey,`Brand`)}},Uc={10:`#061724`,20:`#082338`,30:`#0a2e4a`,40:`#0c3b5e`,50:`#0e4775`,60:`#0f548c`,70:`#115ea3`,80:`#0f6cbd`,90:`#2886de`,100:`#479ef5`,110:`#62abf5`,120:`#77b7f7`,130:`#96c6fa`,140:`#b4d6fa`,150:`#cfe4fa`,160:`#ebf3fc`},$=wc.reduce((e,t)=>{let n=t.slice(0,1).toUpperCase()+t.slice(1),r={[`colorPalette${n}Background1`]:Y[t].shade40,[`colorPalette${n}Background2`]:Y[t].shade30,[`colorPalette${n}Background3`]:Y[t].primary,[`colorPalette${n}Foreground1`]:Y[t].tint30,[`colorPalette${n}Foreground2`]:Y[t].tint40,[`colorPalette${n}Foreground3`]:Y[t].tint20,[`colorPalette${n}BorderActive`]:Y[t].tint30,[`colorPalette${n}Border1`]:Y[t].primary,[`colorPalette${n}Border2`]:Y[t].tint20};return Object.assign(e,r)},{});$.colorPaletteRedForeground3=Y.red.tint30,$.colorPaletteRedBorder2=Y.red.tint30,$.colorPaletteGreenForeground3=Y.green.tint40,$.colorPaletteGreenBorder2=Y.green.tint40,$.colorPaletteDarkOrangeForeground3=Y.darkOrange.tint30,$.colorPaletteDarkOrangeBorder2=Y.darkOrange.tint30,$.colorPaletteRedForegroundInverted=Y.red.primary,$.colorPaletteGreenForegroundInverted=Y.green.primary,$.colorPaletteYellowForegroundInverted=Y.yellow.shade30;var Wc=Tc.reduce((e,t)=>{let n=t.slice(0,1).toUpperCase()+t.slice(1),r={[`colorPalette${n}Background2`]:Cc[t].shade30,[`colorPalette${n}Foreground2`]:Cc[t].tint40,[`colorPalette${n}BorderActive`]:Cc[t].tint30};return Object.assign(e,r)},{});Wc.colorPaletteDarkRedBackground2=Cc.darkRed.shade20,Wc.colorPalettePlumBackground2=Cc.plum.shade20;var Gc={...$,...Wc},Kc=Object.entries(Z).reduce((e,[t,n])=>{let r=t.slice(0,1).toUpperCase()+t.slice(1),i={[`colorStatus${r}Background1`]:X[n].shade40,[`colorStatus${r}Background2`]:X[n].shade30,[`colorStatus${r}Background3`]:X[n].primary,[`colorStatus${r}Foreground1`]:X[n].tint30,[`colorStatus${r}Foreground2`]:X[n].tint40,[`colorStatus${r}Foreground3`]:X[n].tint20,[`colorStatus${r}BorderActive`]:X[n].tint30,[`colorStatus${r}ForegroundInverted`]:X[n].shade10,[`colorStatus${r}Border1`]:X[n].primary,[`colorStatus${r}Border2`]:X[n].tint20};return Object.assign(e,i)},{});Kc.colorStatusDangerBackground3Hover=X[Z.danger].shade10,Kc.colorStatusDangerBackground3Pressed=X[Z.danger].shade20,Kc.colorStatusDangerForeground3=X[Z.danger].tint40,Kc.colorStatusDangerBorder2=X[Z.danger].tint30,Kc.colorStatusSuccessForeground3=X[Z.success].tint40,Kc.colorStatusSuccessBorder2=X[Z.success].tint40,Kc.colorStatusWarningForegroundInverted=X[Z.warning].shade20;var qc=Hc(Uc),Jc=e=>({colorNeutralForeground1:J,colorNeutralForeground1Hover:J,colorNeutralForeground1Pressed:J,colorNeutralForeground1Selected:J,colorNeutralForeground2:G[84],colorNeutralForeground2Hover:J,colorNeutralForeground2Pressed:J,colorNeutralForeground2Selected:J,colorNeutralForeground2BrandHover:e[100],colorNeutralForeground2BrandPressed:e[90],colorNeutralForeground2BrandSelected:e[100],colorNeutralForeground3:G[68],colorNeutralForeground3Hover:G[84],colorNeutralForeground3Pressed:G[84],colorNeutralForeground3Selected:G[84],colorNeutralForeground3BrandHover:e[100],colorNeutralForeground3BrandPressed:e[90],colorNeutralForeground3BrandSelected:e[100],colorNeutralForeground4:G[60],colorNeutralForeground5:G[68],colorNeutralForeground5Hover:J,colorNeutralForeground5Pressed:J,colorNeutralForeground5Selected:J,colorNeutralForegroundDisabled:G[36],colorNeutralForegroundInvertedDisabled:K[40],colorBrandForegroundLink:e[100],colorBrandForegroundLinkHover:e[110],colorBrandForegroundLinkPressed:e[90],colorBrandForegroundLinkSelected:e[100],colorNeutralForeground2Link:G[84],colorNeutralForeground2LinkHover:J,colorNeutralForeground2LinkPressed:J,colorNeutralForeground2LinkSelected:J,colorCompoundBrandForeground1:e[100],colorCompoundBrandForeground1Hover:e[110],colorCompoundBrandForeground1Pressed:e[90],colorBrandForeground1:e[100],colorBrandForeground2:e[110],colorBrandForeground2Hover:e[130],colorBrandForeground2Pressed:e[160],colorNeutralForeground1Static:G[14],colorNeutralForegroundStaticInverted:J,colorNeutralForegroundInverted:G[14],colorNeutralForegroundInvertedHover:G[14],colorNeutralForegroundInvertedPressed:G[14],colorNeutralForegroundInvertedSelected:G[14],colorNeutralForegroundInverted2:G[14],colorNeutralForegroundOnBrand:J,colorNeutralForegroundInvertedLink:J,colorNeutralForegroundInvertedLinkHover:J,colorNeutralForegroundInvertedLinkPressed:J,colorNeutralForegroundInvertedLinkSelected:J,colorBrandForegroundInverted:e[80],colorBrandForegroundInvertedHover:e[70],colorBrandForegroundInvertedPressed:e[60],colorBrandForegroundOnLight:e[80],colorBrandForegroundOnLightHover:e[70],colorBrandForegroundOnLightPressed:e[50],colorBrandForegroundOnLightSelected:e[60],colorNeutralBackground1:G[16],colorNeutralBackground1Hover:G[24],colorNeutralBackground1Pressed:G[12],colorNeutralBackground1Selected:G[22],colorNeutralBackground2:G[12],colorNeutralBackground2Hover:G[20],colorNeutralBackground2Pressed:G[8],colorNeutralBackground2Selected:G[18],colorNeutralBackground3:G[8],colorNeutralBackground3Hover:G[16],colorNeutralBackground3Pressed:G[4],colorNeutralBackground3Selected:G[14],colorNeutralBackground4:G[4],colorNeutralBackground4Hover:G[12],colorNeutralBackground4Pressed:Bs,colorNeutralBackground4Selected:G[10],colorNeutralBackground5:Bs,colorNeutralBackground5Hover:G[8],colorNeutralBackground5Pressed:G[2],colorNeutralBackground5Selected:G[6],colorNeutralBackground6:G[20],colorNeutralBackground7:`#00000000`,colorNeutralBackground7Hover:G[10],colorNeutralBackground7Pressed:G[4],colorNeutralBackground7Selected:`#00000000`,colorNeutralBackground8:G[16],colorNeutralBackgroundInverted:J,colorNeutralBackgroundInvertedHover:G[96],colorNeutralBackgroundInvertedPressed:G[88],colorNeutralBackgroundInvertedSelected:G[92],colorNeutralBackgroundStatic:G[24],colorNeutralBackgroundAlpha:Ls[50],colorNeutralBackgroundAlpha2:Rs[70],colorSubtleBackground:`transparent`,colorSubtleBackgroundHover:G[22],colorSubtleBackgroundPressed:G[18],colorSubtleBackgroundSelected:G[20],colorSubtleBackgroundLightAlphaHover:zs[80],colorSubtleBackgroundLightAlphaPressed:zs[50],colorSubtleBackgroundLightAlphaSelected:`transparent`,colorSubtleBackgroundInverted:`transparent`,colorSubtleBackgroundInvertedHover:q[10],colorSubtleBackgroundInvertedPressed:q[30],colorSubtleBackgroundInvertedSelected:q[20],colorTransparentBackground:`transparent`,colorTransparentBackgroundHover:`transparent`,colorTransparentBackgroundPressed:`transparent`,colorTransparentBackgroundSelected:`transparent`,colorNeutralBackgroundDisabled:G[8],colorNeutralBackgroundDisabled2:G[16],colorNeutralBackgroundInvertedDisabled:K[10],colorNeutralStencil1:G[34],colorNeutralStencil2:G[20],colorNeutralStencil1Alpha:K[10],colorNeutralStencil2Alpha:K[5],colorBackgroundOverlay:q[50],colorScrollbarOverlay:K[60],colorBrandBackground:e[70],colorBrandBackgroundHover:e[80],colorBrandBackgroundPressed:e[40],colorBrandBackgroundSelected:e[60],colorCompoundBrandBackground:e[100],colorCompoundBrandBackgroundHover:e[110],colorCompoundBrandBackgroundPressed:e[90],colorBrandBackgroundStatic:e[80],colorBrandBackground2:e[20],colorBrandBackground2Hover:e[40],colorBrandBackground2Pressed:e[10],colorBrandBackground3Static:e[60],colorBrandBackground4Static:e[40],colorBrandBackgroundInverted:J,colorBrandBackgroundInvertedHover:e[160],colorBrandBackgroundInvertedPressed:e[140],colorBrandBackgroundInvertedSelected:e[150],colorNeutralCardBackground:G[20],colorNeutralCardBackgroundHover:G[24],colorNeutralCardBackgroundPressed:G[18],colorNeutralCardBackgroundSelected:G[22],colorNeutralCardBackgroundDisabled:G[8],colorNeutralStrokeAccessible:G[68],colorNeutralStrokeAccessibleHover:G[74],colorNeutralStrokeAccessiblePressed:G[70],colorNeutralStrokeAccessibleSelected:e[100],colorNeutralStroke1:G[40],colorNeutralStroke1Hover:G[46],colorNeutralStroke1Pressed:G[42],colorNeutralStroke1Selected:G[44],colorNeutralStroke2:G[32],colorNeutralStroke3:G[24],colorNeutralStroke4:G[24],colorNeutralStroke4Hover:G[18],colorNeutralStroke4Pressed:G[14],colorNeutralStroke4Selected:G[24],colorNeutralStrokeSubtle:G[4],colorNeutralStrokeOnBrand:G[16],colorNeutralStrokeOnBrand2:J,colorNeutralStrokeOnBrand2Hover:J,colorNeutralStrokeOnBrand2Pressed:J,colorNeutralStrokeOnBrand2Selected:J,colorBrandStroke1:e[100],colorBrandStroke2:e[50],colorBrandStroke2Hover:e[50],colorBrandStroke2Pressed:e[30],colorBrandStroke2Contrast:e[50],colorCompoundBrandStroke:e[100],colorCompoundBrandStrokeHover:e[110],colorCompoundBrandStrokePressed:e[90],colorNeutralStrokeDisabled:G[26],colorNeutralStrokeDisabled2:G[24],colorNeutralStrokeInvertedDisabled:K[40],colorTransparentStroke:`transparent`,colorTransparentStrokeInteractive:`transparent`,colorTransparentStrokeDisabled:`transparent`,colorNeutralStrokeAlpha:K[10],colorNeutralStrokeAlpha2:K[20],colorStrokeFocus1:Bs,colorStrokeFocus2:J,colorNeutralShadowAmbient:`rgba(0,0,0,0.24)`,colorNeutralShadowKey:`rgba(0,0,0,0.28)`,colorNeutralShadowAmbientLighter:`rgba(0,0,0,0.12)`,colorNeutralShadowKeyLighter:`rgba(0,0,0,0.14)`,colorNeutralShadowAmbientDarker:`rgba(0,0,0,0.40)`,colorNeutralShadowKeyDarker:`rgba(0,0,0,0.48)`,colorBrandShadowAmbient:`rgba(0,0,0,0.30)`,colorBrandShadowKey:`rgba(0,0,0,0.25)`}),Yc=(e=>{let t=Jc(e);return{...jc,...Pc,...Fc,...Lc,...Ic,...Bc,...Rc,...zc,...Nc,...Mc,...t,...Gc,...Kc,...Vc(t.colorNeutralShadowAmbient,t.colorNeutralShadowKey),...Vc(t.colorBrandShadowAmbient,t.colorBrandShadowKey,`Brand`)}})(Uc);Ea.define(Ta),Ma.define(Aa),Ja.define(qa),V.define($a),ao.define(lo),H.define(vo),Eo.define(To),Zo.define(Xo),Vo.define(Go),$o.define(rs),ls.define(cs),vs.define(gs);export{qc as n,Es as r,Yc as t};