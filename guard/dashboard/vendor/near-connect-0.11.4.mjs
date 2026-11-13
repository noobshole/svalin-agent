/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/@hot-labs/near-connect@0.11.4/build/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
var R={},S={},H;function V(){if(H)return S;H=1,Object.defineProperty(S,"__esModule",{value:!0}),S.LocalStorage=void 0;class u{async get(i){return typeof window>"u"?null:localStorage.getItem(i)}async set(i,l){typeof window>"u"||localStorage.setItem(i,l)}async remove(i){typeof window>"u"||localStorage.removeItem(i)}}return S.LocalStorage=u,S}var P={},A={},L={},G;function ve(){if(G)return L;G=1,Object.defineProperty(L,"__esModule",{value:!0}),L.encodeBase58=c;const u="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";function c(i){if(i.length===0)return"";let l=0,e=0;for(;e<i.length&&i[e]===0;)l++,e++;let t=[0];for(;e<i.length;e++){let r=i[e];for(let o=0;o<t.length;++o)r+=t[o]<<8,t[o]=r%58,r=r/58|0;for(;r>0;)t.push(r%58),r=r/58|0}for(;t.length>0&&t[t.length-1]===0;)t.pop();let n="";for(let r=0;r<l;r++)n+=u[0];for(let r=t.length-1;r>=0;--r)n+=u[t[r]];return n}return L}var J;function F(){if(J)return A;J=1,Object.defineProperty(A,"__esModule",{value:!0}),A.nearActionsToConnectorActions=void 0;const u=ve(),c=l=>{try{return JSON.parse(new TextDecoder().decode(l))}catch{return l}},i=l=>l.map(e=>{if("type"in e)return e;if(e.functionCall)return{type:"FunctionCall",params:{methodName:e.functionCall.methodName,args:c(e.functionCall.args),gas:e.functionCall.gas.toString(),deposit:e.functionCall.deposit.toString()}};if(e.deployGlobalContract)return{type:"DeployGlobalContract",params:{code:e.deployGlobalContract.code,deployMode:e.deployGlobalContract.deployMode.AccountId?"AccountId":"CodeHash"}};if(e.createAccount)return{type:"CreateAccount"};if(e.useGlobalContract)return{type:"UseGlobalContract",params:{contractIdentifier:e.useGlobalContract.contractIdentifier.AccountId?{accountId:e.useGlobalContract.contractIdentifier.AccountId}:{codeHash:(0,u.encodeBase58)(e.useGlobalContract.contractIdentifier.CodeHash)}}};if(e.deployContract)return{type:"DeployContract",params:{code:e.deployContract.code}};if(e.deleteAccount)return{type:"DeleteAccount",params:{beneficiaryId:e.deleteAccount.beneficiaryId}};if(e.deleteKey)return{type:"DeleteKey",params:{publicKey:e.deleteKey.publicKey.toString()}};if(e.transfer)return{type:"Transfer",params:{deposit:e.transfer.deposit.toString()}};if(e.stake)return{type:"Stake",params:{stake:e.stake.stake.toString(),publicKey:e.stake.publicKey.toString()}};if(e.addKey)return{type:"AddKey",params:{publicKey:e.addKey.publicKey.toString(),accessKey:{nonce:Number(e.addKey.accessKey.nonce),permission:e.addKey.accessKey.permission.functionCall?{receiverId:e.addKey.accessKey.permission.functionCall.receiverId,allowance:e.addKey.accessKey.permission.functionCall.allowance?.toString(),methodNames:e.addKey.accessKey.permission.functionCall.methodNames}:"FullAccess"}}};throw new Error("Unsupported action type")});return A.nearActionsToConnectorActions=i,A}var I={},Y;function B(){if(Y)return I;Y=1,Object.defineProperty(I,"__esModule",{value:!0}),I.uuid4=void 0;const u=()=>typeof window<"u"&&typeof window.crypto<"u"&&typeof window.crypto.randomUUID=="function"?window.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){const i=Math.random()*16|0;return(c==="x"?i:i&3|8).toString(16)});return I.uuid4=u,I}var X;function Z(){if(X)return P;X=1,Object.defineProperty(P,"__esModule",{value:!0}),P.ParentFrameWallet=void 0;const u=F(),c=B();let i=class{connector;manifest;constructor(e,t){this.connector=e,this.manifest=t}callParentFrame(e,t){const n=(0,c.uuid4)();return window.parent.postMessage({type:"near-wallet-injected-request",id:n,method:e,params:t},"*"),new Promise((r,o)=>{const h=f=>{f.data.type==="near-wallet-injected-response"&&f.data.id===n&&(window.removeEventListener("message",h),f.data.success?r(f.data.result):o(f.data.error))};window.addEventListener("message",h)})}async signIn(e){const t=await this.callParentFrame("near:signIn",{network:e?.network??this.connector.network,addFunctionCallKey:e?.addFunctionCallKey});return Array.isArray(t)?t:[t]}async signInAndSignMessage(e){const t=await this.callParentFrame("near:signInAndSignMessage",{network:e?.network??this.connector.network,addFunctionCallKey:e?.addFunctionCallKey,messageParams:e.messageParams});return Array.isArray(t)?t:[t]}async signOut(e){const t={...e,network:e?.network??this.connector.network};await this.callParentFrame("near:signOut",t)}async getAccounts(e){const t={...e,network:e?.network??this.connector.network};return this.callParentFrame("near:getAccounts",t)}async signAndSendTransaction(e){const t=(0,u.nearActionsToConnectorActions)(e.actions),n={...e,actions:t,network:e.network??this.connector.network};return this.callParentFrame("near:signAndSendTransaction",n)}async signAndSendTransactions(e){const t={...e,network:e.network??this.connector.network};return t.transactions=t.transactions.map(n=>({actions:(0,u.nearActionsToConnectorActions)(n.actions),receiverId:n.receiverId})),this.callParentFrame("near:signAndSendTransactions",t)}async signMessage(e){const t={...e,network:e.network??this.connector.network};return this.callParentFrame("near:signMessage",t)}async signDelegateActions(e){const t={...e,delegateActions:e.delegateActions.map(n=>({...n,actions:(0,u.nearActionsToConnectorActions)(n.actions)})),network:e.network||this.connector.network};return this.callParentFrame("near:signDelegateActions",t)}};return P.ParentFrameWallet=i,P}var y={},x={},_={},Q;function ee(){if(Q)return _;Q=1,Object.defineProperty(_,"__esModule",{value:!0}),_.parseUrl=void 0;const u=c=>{try{return new URL(c)}catch{return null}};return _.parseUrl=u,_}var k={},E={},te;function ne(){if(te)return E;te=1,Object.defineProperty(E,"__esModule",{value:!0}),E.EventEmitter=void 0;class u{events={};on(i,l){this.events[i]||(this.events[i]=[]),this.events[i].push(l)}emit(i,l){this.events[i]?.forEach(e=>e(l))}off(i,l){this.events[i]=this.events[i]?.filter(e=>e!==l)}once(i,l){const e=t=>{l(t),this.off(i,e)};this.on(i,e)}removeAllListeners(i){i?delete this.events[i]:this.events={}}}return E.EventEmitter=u,E}var W={},M={},re;function U(){if(re)return M;re=1,Object.defineProperty(M,"__esModule",{value:!0}),M.escapeHtml=u,M.html=i;function u(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}const c=Symbol("htmlTag");function i(l,...e){let t=l[0];for(let n=0;n<e.length;n++){for(const r of Array.isArray(e[n])?e[n]:[e[n]]){const o=r?.[c]?r[c]:u(String(r??""));t+=o}t+=l[n+1]}return Object.freeze({[c]:t,get html(){return t}})}return M}var $={},N={},oe;function xe(){if(oe)return N;oe=1,Object.defineProperty(N,"__esModule",{value:!0}),N.css=void 0;const u=c=>`
${c} * {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  -ms-overflow-style: none; 
  scrollbar-width: none; 
  color: #fff;
}

${c} *::-webkit-scrollbar { 
  display: none;
}

${c} p,
${c} h1,
${c} h2,
${c} h3,
${c} h4,
${c} h5,
${c} h6 {
  margin: 0;
}

${c} .modal-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 100000000;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    transition: opacity 0.2s ease-in-out;
}

@media (max-width: 600px) {
  ${c} .modal-container {
    justify-content: flex-end;
  }
}

${c} .modal-content {
  display: flex;
  flex-direction: column;
  align-items: center;

  max-width: 420px;
  max-height: 615px;
  width: 100%;
  border-radius: 24px;
  background: #0d0d0d;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  transition: transform 0.2s ease-in-out;
}

@media (max-width: 600px) {
  ${c} .modal-content {
    max-width: 100%;
    width: 100%;
    max-height: 80%;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border: none;
    border-top: 1.5px solid rgba(255, 255, 255, 0.1);
  }
}


${c} .modal-header {
  display: flex;
  padding: 16px;
  gap: 16px;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  position: relative;
}

${c} .modal-header button {
  position: absolute;
  right: 16px;
  top: 16px;
  width: 32px;
  height: 32px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s ease-in-out;
  border: none;
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

${c} .modal-header button:hover {
  background: rgba(255, 255, 255, 0.04);
}
  
${c} .modal-header p {
  color: #fff;
  text-align: center;
  font-size: 24px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  margin: 0;
}


${c} .modal-body {
  display: flex;
  padding: 16px;
  flex-direction: column;
  align-items: flex-start;
  text-align: center;
  gap: 8px;
  overflow: auto;

  border-radius: 24px;
  background: rgba(255, 255, 255, 0.08);
  width: 100%;
  flex: 1;
}

${c} .modal-body textarea {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  background: #0d0d0d;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  outline: none;
  font-size: 16px;
  transition: background 0.2s ease-in-out;
  font-family: monospace;
  font-size: 12px;
}

${c} .modal-body button {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  color: #000;
  border: none;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s ease-in-out;
  margin-top: 16px;
}

${c} .footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 16px 24px;
  color: #fff;
  gap: 12px;
}

${c} .modal-body p {
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: normal;
  letter-spacing: -0.8px;
}

${c} .footer img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

${c} .get-wallet-link {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  margin-left: auto;
  text-decoration: none;
  transition: color 0.2s ease-in-out;
  cursor: pointer;
}
  
${c} .get-wallet-link:hover {
  color: rgba(255, 255, 255, 1);
}


${c} .connect-item {
  display: flex;
  padding: 8px;
  align-items: center;
  gap: 12px;
  align-self: stretch;
  cursor: pointer;

  transition: background 0.2s ease-in-out;
  border-radius: 24px;
}

${c} .connect-item img {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  object-fit: cover;
  flex-shrink: 0;
}

${c} .connect-item-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  text-align: left;
  flex: 1;
  margin-top: -2px;
}

${c} .connect-item-info .wallet-address {
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
}

${c} .connect-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

${c} .connect-item img {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  object-fit: cover;
}

${c} .connect-item p {
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  font-size: 18px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  letter-spacing: -0.36px;
  margin: 0;
}
`;return N.css=u,N}var se;function ae(){if(se)return $;se=1,Object.defineProperty($,"__esModule",{value:!0}),$.Popup=void 0;const u=xe(),c=U(),i=`n${Math.random().toString(36).substring(2,15)}`;if(typeof document<"u"){const e=document.createElement("style");e.textContent=(0,u.css)(`.${i}`),document.head.append(e)}let l=class{delegate;isClosed=!1;root=document.createElement("div");state={};constructor(t){this.delegate=t}get dom(){return(0,c.html)``}disposables=[];addListener(t,n,r){const o=typeof t=="string"?this.root.querySelector(t):t;o&&(o.addEventListener(n,r),this.disposables.push(()=>o.removeEventListener(n,r)))}handlers(){this.disposables.forEach(r=>r()),this.disposables=[];const t=this.root.querySelector(".modal-container"),n=this.root.querySelector(".modal-content");n.onclick=r=>r.stopPropagation(),t.onclick=()=>{this.delegate.onReject(),this.destroy()}}update(t){this.state={...this.state,...t},this.root.innerHTML=this.dom.html,this.handlers()}create({show:t=!0}){this.root.className=`${i} hot-connector-popup`,this.root.innerHTML=this.dom.html,document.body.append(this.root),this.handlers();const n=this.root.querySelector(".modal-container"),r=this.root.querySelector(".modal-content");r.style.transform="translateY(50px)",n.style.opacity="0",this.root.style.display="none",t&&setTimeout(()=>this.show(),10)}show(){const t=this.root.querySelector(".modal-container"),n=this.root.querySelector(".modal-content");n.style.transform="translateY(50px)",t.style.opacity="0",this.root.style.display="block",setTimeout(()=>{n.style.transform="translateY(0)",t.style.opacity="1"},100)}hide(){const t=this.root.querySelector(".modal-container"),n=this.root.querySelector(".modal-content");n.style.transform="translateY(50px)",t.style.opacity="0",setTimeout(()=>{this.root.style.display="none"},200)}destroy(){this.isClosed||(this.isClosed=!0,this.hide(),setTimeout(()=>{this.root.remove()},200))}};return $.Popup=l,$}var ie;function ke(){if(ie)return W;ie=1,Object.defineProperty(W,"__esModule",{value:!0}),W.IframeWalletPopup=void 0;const u=U(),c=ae();let i=class extends c.Popup{delegate;constructor(e){super(e),this.delegate=e}handlers(){super.handlers(),this.addListener("button","click",()=>this.delegate.onApprove())}create(){super.create({show:!1}),this.root.querySelector(".modal-body").appendChild(this.delegate.iframe),this.delegate.iframe.style.width="100%",this.delegate.iframe.style.height="720px",this.delegate.iframe.style.border="none"}get footer(){if(!this.delegate.footer)return"";const{icon:e,heading:t}=this.delegate.footer;return(0,u.html)`
      <div class="footer">
        ${e?(0,u.html)`<img src="${e}" alt="${t}" />`:""}
        <p>${t}</p>
      </div>
    `}get dom(){return(0,u.html)`<div class="modal-container">
      <div class="modal-content">
        <div class="modal-body" style="padding: 0; overflow: auto;"></div>
        ${this.footer}
      </div>
    </div>`}};return W.IframeWalletPopup=i,W}var D={},j={},le;function Ce(){return le||(le=1,Object.defineProperty(j,"__esModule",{value:!0}),j.NEAR_CONNECT_VERSION=void 0,j.NEAR_CONNECT_VERSION="0.11.4"),j}var ce;function Se(){if(ce)return D;ce=1,Object.defineProperty(D,"__esModule",{value:!0});const u=Ce();async function c(i){const l=await i.executor.getAllStorage(),e=i.executor.connector.providers,t=i.executor.manifest,n=i.id,r=i.code.replaceAll(".localStorage",".sandboxedLocalStorage").replaceAll("window.top","window.selector").replaceAll("window.open","window.selector.open"),o=i.cspNonce?` nonce="${i.cspNonce.replace(/[^A-Za-z0-9+/=]/g,"")}"`:"";return`
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body>
      <div id="root"></div>

      <style>
        :root {
          --background-color: rgb(40, 40, 40);
          --text-color: rgb(255, 255, 255);
          --border-color: rgb(209, 209, 209);
        }

        * {
          font-family: system-ui, Avenir, Helvetica, Arial, sans-serif
        }

        body, html {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          background-color: var(--background-color);
          color: var(--text-color);
        }

        #root {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          width: 100vw;
          background: radial-gradient(circle at center, #2c2c2c 0%, #1a1a1a 100%);
          text-align: center;
        }

        #root * {
          box-sizing: border-box;
          font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
          line-height: 1.5;
          color-scheme: light dark;
          color: rgb(255, 255, 255);
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
        }

        .prompt-container img {
          width: 100px;
          height: 100px;
          object-fit: cover;
          border-radius: 12px;
        }

        .prompt-container h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          margin-top: 16px;
        }

        .prompt-container p {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: rgb(209, 209, 209);
        }

        .prompt-container button {
          background-color: #131313;
          border: none;
          border-radius: 12px;
          padding: 12px 24px;
          cursor: pointer;
          transition: border-color 0.25s;
          color: #fff;
          outline: none;
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          margin-top: 16px;
        }
      </style>


      <script${o}>
      window.sandboxedLocalStorage = (() => {
        let storage = ${JSON.stringify(l)}

        return {
          setItem: function(key, value) {
            window.selector.storage.set(key, value)
            storage[key] = value || '';
          },
          getItem: function(key) {
            return key in storage ? storage[key] : null;
          },
          removeItem: function(key) {
            window.selector.storage.remove(key)
            delete storage[key];
          },
          get length() {
            return Object.keys(storage).length;
          },
          key: function(i) {
            const keys = Object.keys(storage);
            return keys[i] || null;
          },
        };
      })();

      const showPrompt = async (args) => {
        const root = document.getElementById("root");   
        root.style.display = "flex";
        root.innerHTML = \`
          <div class="prompt-container">
            <img src="${t.icon}" />
            <h1>${t.name}</h1>
            <p>\${args.title}</p>
            <button>\${args.button}</button>
          </div>
        \`;

        return new Promise((resolve) => {
          root.querySelector("button")?.addEventListener("click", () => {
            root.innerHTML = "";
            resolve(true);
          });
        });
      }

      class ProxyWindow {
        constructor(url, features) {
          this.closed = false;
          this.windowIdPromise = window.selector.call("open", { url, features });

          window.addEventListener("message", async (event) => {            
            if (event.data.origin !== "${n}") return;
            if (!event.data.method?.startsWith("proxy-window:")) return;
            const method = event.data.method.replace("proxy-window:", "");
            if (method === "closed" && event.data.windowId === await this.id()) this.closed = true;
          });
        } 

        async id() {
          return await this.windowIdPromise;
        }

        async focus() {
          await window.selector.call("panel.focus", { windowId: await this.id() });
        }

        async postMessage(data) {
          window.selector.call("panel.postMessage", { windowId: await this.id(), data });
        }

        async close() {
          await window.selector.call("panel.close", { windowId: await this.id() });
        }
      }

      window.selector = {
        wallet: null,
        location: "${window.location.href}",
        nearConnectVersion: "${u.NEAR_CONNECT_VERSION}",
        
        outerHeight: ${window.outerHeight},
        screenY: ${window.screenY},
        outerWidth: ${window.outerWidth},
        screenX: ${window.screenX},

        providers: {
          mainnet: ${JSON.stringify(e.mainnet)},
          testnet: ${JSON.stringify(e.testnet)},
        },

        uuid() {
          return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
        },

        walletConnect: {
          connect(params) {
            return window.selector.call("walletConnect.connect", params);
          },
          disconnect(params) {
            return window.selector.call("walletConnect.disconnect", params);
          },
          request(params) {
            return window.selector.call("walletConnect.request", params);
          },
          getProjectId() {
            return window.selector.call("walletConnect.getProjectId", {});
          },
          getSession() {
            return window.selector.call("walletConnect.getSession", {});
          },
        },
      
        async ready(wallet) {
          wallet.manifest = ${JSON.stringify(t)};
          window.parent.postMessage({ method: "wallet-ready", origin: "${n}" }, "*");
          window.selector.wallet = wallet;
        },

        async call(method, params) {
          const id = window.selector.uuid();
          window.parent.postMessage({ method, params, id, origin: "${n}" }, "*");

          return new Promise((resolve, reject) => {
            const handler = (event) => {
              if (event.data.id !== id || event.data.origin !== "${n}") return;
              window.removeEventListener("message", handler);

              if (event.data.status === "failed") reject(event.data.result);
              else resolve(event.data.result);
            };

            window.addEventListener("message", handler);
          });
        },

        panelClosed(windowId) {
          window.parent.postMessage({ 
            method: "panel.closed", 
            origin: "${n}", 
            result: { windowId } 
          }, "*");
        },

        open(url, _, params) {
          return new ProxyWindow(url, params)
        },

        external(entity, key, ...args) {
          return window.selector.call("external", { entity, key, args: args || [] });
        },

        openNativeApp(url) {
          return window.selector.call("open.nativeApp", { url });
        },

        ui: {
          async whenApprove(options) {
            window.selector.ui.showIframe();
            await showPrompt(options);
            window.selector.ui.hideIframe();
          },

          async showIframe() {
            return await window.selector.call("ui.showIframe");
          },

          async hideIframe() {
            return await window.selector.call("ui.hideIframe");
          },
        },

        storage: {
          async set(key, value) {
            await window.selector.call("storage.set", { key, value });
          },
      
          async get(key) {
            return await window.selector.call("storage.get", { key });
          },
      
          async remove(key) {
            await window.selector.call("storage.remove", { key });
          },

          async keys() {
            return await window.selector.call("storage.keys", {});
          },
        },
      };

      window.addEventListener("message", async (event) => {
        if (event.data.origin !== "${n}") return;
        if (!event.data.method?.startsWith("wallet:")) return;
      
        const wallet = window.selector.wallet;
        const method = event.data.method.replace("wallet:", "");
        const payload = { id: event.data.id, origin: "${n}", method };
      
        if (wallet == null || typeof wallet[method] !== "function") {
          const data = { ...payload, status: "failed", result: "Method not found" };
          window.parent.postMessage(data, "*");
          return;
        }
        
        try {
          const result = await wallet[method](event.data.params);
          window.parent.postMessage({ ...payload, status: "success", result }, "*");
        } catch (error) {
          const data = { ...payload, status: "failed", result: error };
          window.parent.postMessage(data, "*");
        }
      });
      <\/script>

      <script type="module"${o}>${r}<\/script>
    </body>
  </html>
    `}return D.default=c,D}var de;function Pe(){if(de)return k;de=1;var u=k&&k.__importDefault||function(n){return n&&n.__esModule?n:{default:n}};Object.defineProperty(k,"__esModule",{value:!0});const c=ne(),i=B(),l=ke(),e=u(Se());class t{executor;origin;iframe=document.createElement("iframe");events=new c.EventEmitter;popup;handler;readyPromiseResolve;readyPromise=new Promise(r=>{this.readyPromiseResolve=r});constructor(r,o,h,f){this.executor=r,this.origin=(0,i.uuid4)(),this.handler=s=>{s.data.origin===this.origin&&(s.data.method==="wallet-ready"&&this.readyPromiseResolve(),h(this,s))},window.addEventListener("message",this.handler);const d=[];this.executor.checkPermissions("usb")&&d.push("usb *;"),this.executor.checkPermissions("hid")&&d.push("hid *;"),this.executor.checkPermissions("clipboardRead")&&d.push("clipboard-read;"),this.executor.checkPermissions("clipboardWrite")&&d.push("clipboard-write;"),this.executor.checkPermissions("bluetooth")&&d.push("bluetooth *;"),this.iframe.allow=d.join(" "),this.iframe.setAttribute("sandbox","allow-scripts"),(0,e.default)({id:this.origin,executor:this.executor,code:o,cspNonce:f}).then(s=>{this.executor.connector.logger?.log("Iframe code injected"),this.iframe.srcdoc=s}),this.popup=new l.IframeWalletPopup({footer:this.executor.connector.footerBranding,iframe:this.iframe,onApprove:()=>{},onReject:()=>{window.removeEventListener("message",this.handler),this.events.emit("close",{}),this.popup.destroy()}}),this.popup.create()}on(r,o){this.events.on(r,o)}show(){this.popup.show()}hide(){this.popup.hide()}postMessage(r){if(!this.iframe.contentWindow)throw new Error("Iframe not loaded");this.iframe.contentWindow.postMessage({...r,origin:this.origin},"*")}dispose(){window.removeEventListener("message",this.handler),this.popup.destroy()}}return k.default=t,k}var ue;function Ae(){if(ue)return x;ue=1;var u=x&&x.__importDefault||function(n){return n&&n.__esModule?n:{default:n}};Object.defineProperty(x,"__esModule",{value:!0});const c=ee(),i=B(),l=u(Pe()),e=(0,i.uuid4)();class t{connector;manifest;activePanels={};storageSpace;constructor(r,o){this.connector=r,this.manifest=o,this.storageSpace=o.id}checkPermissions(r,o){if(r==="walletConnect")return!!this.manifest.permissions.walletConnect;if(r==="external"){const h=this.manifest.permissions.external;return!h||!o?.entity?!1:h.includes(o.entity)}if(r==="allowsOpen"){const h=(0,c.parseUrl)(o?.url||""),f=this.manifest.permissions.allowsOpen;return!h||!f||!Array.isArray(f)||f.length===0?!1:f.some(s=>{const a=(0,c.parseUrl)(s);return!(!a||h.protocol!==a.protocol||a.hostname&&h.hostname!==a.hostname||a.pathname&&a.pathname!=="/"&&h.pathname!==a.pathname)})}return this.manifest.permissions[r]}assertPermissions(r,o,h){if(!this.checkPermissions(o,h.data.params))throw r.postMessage({...h.data,status:"failed",result:"Permission denied"}),new Error("Permission denied")}_onMessage=async(r,o)=>{const h=d=>{r.postMessage({...o.data,status:"success",result:d})},f=d=>{r.postMessage({...o.data,status:"failed",result:d})};if(o.data.method==="ui.showIframe"){r.show(),h(null);return}if(o.data.method==="ui.hideIframe"){r.hide(),h(null);return}if(o.data.method==="storage.set"){this.assertPermissions(r,"storage",o),localStorage.setItem(`${this.storageSpace}:${o.data.params.key}`,o.data.params.value),h(null);return}if(o.data.method==="storage.get"){this.assertPermissions(r,"storage",o);const d=localStorage.getItem(`${this.storageSpace}:${o.data.params.key}`);h(d);return}if(o.data.method==="storage.keys"){this.assertPermissions(r,"storage",o);const d=Object.keys(localStorage).filter(s=>s.startsWith(`${this.storageSpace}:`));h(d);return}if(o.data.method==="storage.remove"){this.assertPermissions(r,"storage",o),localStorage.removeItem(`${this.storageSpace}:${o.data.params.key}`),h(null);return}if(o.data.method==="panel.focus"){const d=this.activePanels[o.data.params.windowId];d&&d.focus(),h(null);return}if(o.data.method==="panel.postMessage"){const d=this.activePanels[o.data.params.windowId];d&&d.postMessage(o.data.params.data,"*"),h(null);return}if(o.data.method==="panel.close"){const d=this.activePanels[o.data.params.windowId];d&&d.close(),delete this.activePanels[o.data.params.windowId],h(null);return}if(o.data.method==="walletConnect.connect"){this.assertPermissions(r,"walletConnect",o);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const s=await(await this.connector.walletConnect).connect(o.data.params);s.approval(),h({uri:s.uri})}catch(d){f(d)}return}if(o.data.method==="walletConnect.getProjectId"){if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");this.assertPermissions(r,"walletConnect",o);const d=await this.connector.walletConnect;h(d.core.projectId);return}if(o.data.method==="walletConnect.disconnect"){this.assertPermissions(r,"walletConnect",o);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const s=await(await this.connector.walletConnect).disconnect(o.data.params);h(s)}catch(d){f(d)}return}if(o.data.method==="walletConnect.getSession"){this.assertPermissions(r,"walletConnect",o);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const d=await this.connector.walletConnect,s=d.session.keys[d.session.keys.length-1],a=s?d.session.get(s):null;h(a?{topic:a.topic,namespaces:a.namespaces}:null)}catch(d){f(d)}return}if(o.data.method==="walletConnect.request"){this.assertPermissions(r,"walletConnect",o);try{if(!this.connector.walletConnect)throw new Error("WalletConnect is not configured");const s=await(await this.connector.walletConnect).request(o.data.params);h(s)}catch(d){f(d)}return}if(o.data.method==="external"){this.assertPermissions(r,"external",o);try{const{entity:d,key:s,args:a}=o.data.params,g=d.split(".").reduce((m,p)=>m[p],window);d==="nightly.near"&&s==="signTransaction"&&(a[0].encode=()=>a[0]);const w=typeof g[s]=="function"?await g[s](...a||[]):g[s];h(w)}catch(d){f(d)}return}if(o.data.method==="open"){this.assertPermissions(r,"allowsOpen",o);const d=typeof window<"u"?window?.Telegram?.WebApp:null;if(d&&o.data.params.url.startsWith("https://t.me")){d.openTelegramLink(o.data.params.url);return}const s=window.open(o.data.params.url,"_blank",o.data.params.features),a=s?(0,i.uuid4)():null,g=w=>{const m=(0,c.parseUrl)(o.data.params.url);m&&m.origin===w.origin&&r.postMessage(w.data)};if(h(a),window.addEventListener("message",g),s&&a){this.activePanels[a]=s;const w=setInterval(()=>{if(!s?.closed)return;window.removeEventListener("message",g);const m={method:"proxy-window:closed",windowId:a};delete this.activePanels[a],clearInterval(w);try{r.postMessage(m)}catch{}},500)}return}if(o.data.method==="open.nativeApp"){this.assertPermissions(r,"allowsOpen",o);const d=(0,c.parseUrl)(o.data.params.url);if(!d||["https","http","javascript:","file:","data:","blob:","about:"].includes(d.protocol))throw f("Invalid URL"),new Error("[open.nativeApp] Invalid URL");const a=document.createElement("iframe");a.src=o.data.params.url,a.style.display="none",document.body.appendChild(a),r.postMessage({...o.data,status:"success",result:null});return}};actualCode=null;async checkNewVersion(r,o){if(this.actualCode)return this.connector.logger?.log("New version of code already checked"),this.actualCode;let h=(0,c.parseUrl)(r.manifest.executor);if(h||(h=(0,c.parseUrl)(location.origin+r.manifest.executor)),!h)throw new Error("Invalid executor URL");h.searchParams.set("nonce",e);const f=await fetch(h.toString()).then(d=>d.text());return this.connector.logger?.log("New version of code fetched"),this.actualCode=f,f===o?(this.connector.logger?.log("New version of code is the same as the current version"),this.actualCode):(await this.connector.db.setItem(`${this.manifest.id}:${this.manifest.version}`,f),this.connector.logger?.log("New version of code saved to cache"),f)}async loadCode(){const r=await this.connector.db.getItem(`${this.manifest.id}:${this.manifest.version}`).catch(()=>null);this.connector.logger?.log("Code loaded from cache",r!==null);const o=this.checkNewVersion(this,r);return r||await o}async call(r,o){this.connector.logger?.log("Add to queue",r,o),this.connector.logger?.log("Calling method",r,o);const h=await this.loadCode();this.connector.logger?.log("Code loaded, preparing");const f=new l.default(this,h,this._onMessage,this.connector.cspNonce);this.connector.logger?.log("Code loaded, iframe initialized"),await f.readyPromise,this.connector.logger?.log("Iframe ready");const d=(0,i.uuid4)();return new Promise((s,a)=>{try{const g=w=>{w.data.id!==d||w.data.origin!==f.origin||(f.dispose(),window.removeEventListener("message",g),this.connector.logger?.log("postMessage",{result:w.data,request:{method:r,params:o}}),w.data.status==="failed"?a(w.data.result):s(w.data.result))};window.addEventListener("message",g),f.postMessage({method:r,params:o,id:d}),f.on("close",()=>a(new Error("Wallet closed")))}catch(g){this.connector.logger?.log("Iframe error",g),a(g)}})}async getAllStorage(){const r=Object.keys(localStorage).filter(h=>h.startsWith(`${this.storageSpace}:`)),o={};for(const h of r)o[h.replace(`${this.storageSpace}:`,"")]=localStorage.getItem(h);return o}async clearStorage(){const r=Object.keys(localStorage).filter(o=>o.startsWith(`${this.storageSpace}:`));for(const o of r)localStorage.removeItem(o)}}return x.default=t,x}var he;function we(){if(he)return y;he=1;var u=y&&y.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(y,"__esModule",{value:!0}),y.SandboxWallet=void 0;const c=F(),i=u(Ae());class l{connector;manifest;executor;constructor(t,n){this.connector=t,this.manifest=n,this.executor=new i.default(t,n)}async signIn(t){return this.executor.call("wallet:signIn",{network:t?.network??this.connector.network,addFunctionCallKey:t?.addFunctionCallKey})}async signInAndSignMessage(t){return this.executor.call("wallet:signInAndSignMessage",{network:t?.network??this.connector.network,addFunctionCallKey:t?.addFunctionCallKey,messageParams:t.messageParams})}async signOut(t){const n={...t,network:t?.network??this.connector.network};await this.executor.call("wallet:signOut",n),await this.executor.clearStorage()}async getAccounts(t){const n={...t,network:t?.network??this.connector.network};return this.executor.call("wallet:getAccounts",n)}async signAndSendTransaction(t){const n=(0,c.nearActionsToConnectorActions)(t.actions),r={...t,actions:n,network:t.network??this.connector.network};return this.executor.call("wallet:signAndSendTransaction",r)}async signAndSendTransactions(t){const n=t.transactions.map(o=>({actions:(0,c.nearActionsToConnectorActions)(o.actions),receiverId:o.receiverId})),r={...t,transactions:n,network:t.network??this.connector.network};return this.executor.call("wallet:signAndSendTransactions",r)}async signMessage(t){const n={...t,network:t.network??this.connector.network};return this.executor.call("wallet:signMessage",n)}async signDelegateActions(t){const n={...t,delegateActions:t.delegateActions.map(r=>({...r,actions:(0,c.nearActionsToConnectorActions)(r.actions)})),network:t.network??this.connector.network};return this.executor.call("wallet:signDelegateActions",n)}}return y.SandboxWallet=l,y.default=l,y}var q={},ge;function fe(){if(ge)return q;ge=1,Object.defineProperty(q,"__esModule",{value:!0}),q.InjectedWallet=void 0;const u=F();let c=class{connector;wallet;constructor(l,e){this.connector=l,this.wallet=e}get manifest(){return this.wallet.manifest}async signIn({addFunctionCallKey:l,network:e}){return this.wallet.signIn({network:e??this.connector.network,addFunctionCallKey:l})}async signInAndSignMessage(l){return this.wallet.signInAndSignMessage({network:l?.network??this.connector.network,addFunctionCallKey:l.addFunctionCallKey,messageParams:l.messageParams})}async signOut(l){await this.wallet.signOut({network:l?.network??this.connector.network})}async getAccounts(l){return this.wallet.getAccounts({network:l?.network??this.connector.network})}async signAndSendTransaction(l){const e=(0,u.nearActionsToConnectorActions)(l.actions),t=l.network??this.connector.network,n=await this.wallet.signAndSendTransaction({...l,actions:e,network:t});if(!n)throw new Error("No result from wallet");return Array.isArray(n.transactions)?n.transactions[0]:n}async signAndSendTransactions(l){const e=l.network??this.connector.network,t=l.transactions.map(r=>({actions:(0,u.nearActionsToConnectorActions)(r.actions),receiverId:r.receiverId})),n=await this.wallet.signAndSendTransactions({...l,transactions:t,network:e});if(!n)throw new Error("No result from wallet");return Array.isArray(n.transactions)?n.transactions:n}async signMessage(l){return this.wallet.signMessage({...l,network:l.network??this.connector.network})}async signDelegateActions(l){return this.wallet.signDelegateActions({...l,delegateActions:l.delegateActions.map(e=>({...e,actions:(0,u.nearActionsToConnectorActions)(e.actions)})),network:l.network??this.connector.network})}};return q.InjectedWallet=c,q}var v={},O={},me;function Ie(){if(me)return O;me=1,Object.defineProperty(O,"__esModule",{value:!0}),O.NearWalletsPopup=void 0;const u=U(),c=ee(),i=ae(),l={id:"custom-wallet",name:"Custom Wallet",icon:"https://www.mynearwallet.com/images/webclip.png",description:"Custom wallet for NEAR.",website:"",version:"1.0.0",executor:"your-executor-url.js",type:"sandbox",platform:{},features:{signMessage:!0,signInWithoutAddKey:!0,signInAndSignMessage:!0,signAndSendTransaction:!0,signAndSendTransactions:!0,signDelegateActions:!0},permissions:{storage:!0,allowsOpen:[]}};let e=class extends i.Popup{delegate;constructor(n){super(n),this.delegate=n,this.update({wallets:n.wallets,showSettings:!1})}handlers(){super.handlers(),this.addListener(".settings-button","click",()=>this.update({showSettings:!0})),this.addListener(".back-button","click",()=>this.update({showSettings:!1})),this.root.querySelectorAll(".connect-item").forEach(n=>{n instanceof HTMLDivElement&&this.addListener(n,"click",()=>this.delegate.onSelect(n.dataset.type))}),this.root.querySelectorAll(".remove-wallet-button").forEach(n=>{n instanceof SVGSVGElement&&this.addListener(n,"click",async r=>{r.stopPropagation(),await this.delegate.onRemoveDebugManifest(n.dataset.type);const o=this.state.wallets.filter(h=>h.id!==n.dataset.type);this.update({wallets:o})})}),this.addListener(".add-debug-manifest-button","click",async()=>{try{const n=this.root.querySelector("#debug-manifest-input")?.value??"",r=await this.delegate.onAddDebugManifest(n);this.update({showSettings:!1,wallets:[r,...this.state.wallets]})}catch(n){alert(`Something went wrong: ${n}`)}})}create(){super.create({show:!0})}walletDom(n){const r=(0,u.html)`
      <svg
        class="remove-wallet-button"
        data-type="${n.id}"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style="margin-right: 4px;"
      >
        <path d="M18 6L6 18" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M6 6L18 18" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;return(0,u.html)`
      <div class="connect-item" data-type="${n.id}">
        <img style="background: #333" src="${n.icon}" alt="${n.name}" />
        <div class="connect-item-info">
          <span>${n.name}</span>
          <span class="wallet-address">${(0,c.parseUrl)(n.website)?.hostname}</span>
        </div>
        ${n.debug?r:""}
      </div>
    `}get footer(){if(!this.delegate.footer)return"";const{icon:n,heading:r,link:o,linkText:h}=this.delegate.footer;return(0,u.html)`
      <div class="footer">
        ${n?(0,u.html)`<img src="${n}" alt="${r}" />`:""}
        <p>${r}</p>
        <a class="get-wallet-link" href="${o}" target="_blank">${h}</a>
      </div>
    `}get dom(){return this.state.showSettings?(0,u.html)`
        <div class="modal-container">
          <div class="modal-content">
            <div class="modal-header">
              <button class="back-button" style="left: 16px; right: unset;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 18L9 12L15 6" stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <p>Settings</p>
            </div>

            <div class="modal-body">
              <p style="text-align: left;">
                You can add your wallet to dapp for debug,
                <a href="https://github.com/azbang/hot-connector" target="_blank">read the documentation.</a> Paste your manifest and click "Add".
              </p>

              <textarea style="width: 100%;" id="debug-manifest-input" rows="10">${JSON.stringify(l,null,2)}</textarea>
              <button class="add-debug-manifest-button">Add</button>
            </div>

            ${this.footer}
          </div>
        </div>
      `:(0,u.html)`<div class="modal-container">
      <div class="modal-content">
        <div class="modal-header">
          <p>Select wallet</p>
          <button class="settings-button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="2" fill="rgba(255,255,255,0.5)" />
              <circle cx="19" cy="12" r="2" fill="rgba(255,255,255,0.5)" />
              <circle cx="5" cy="12" r="2" fill="rgba(255,255,255,0.5)" />
            </svg>
          </button>
        </div>

        <div class="modal-body">${this.state.wallets.map(n=>this.walletDom(n))}</div>

        ${this.footer}
      </div>
    </div>`}};return O.NearWalletsPopup=e,O}var T={},pe;function _e(){if(pe)return T;pe=1,Object.defineProperty(T,"__esModule",{value:!0});class u{dbName;storeName;version;constructor(i,l){this.dbName=i,this.storeName=l,this.version=1}getDb(){return new Promise((i,l)=>{if(typeof window>"u"||typeof indexedDB>"u"){l(new Error("IndexedDB is not available (SSR environment)"));return}const e=indexedDB.open(this.dbName,this.version);e.onerror=t=>{console.error("Error opening database:",t.target.error),l(new Error("Error opening database"))},e.onsuccess=t=>{i(e.result)},e.onupgradeneeded=t=>{const n=e.result;n.objectStoreNames.contains(this.storeName)||n.createObjectStore(this.storeName)}})}async getItem(i){const l=await this.getDb();if(typeof i=="number"&&(i=i.toString()),typeof i!="string")throw new Error("Key must be a string");return new Promise((e,t)=>{if(!this.storeName){t(new Error("Store name not set"));return}const n=l.transaction(this.storeName,"readonly");n.onerror=h=>t(n.error);const o=n.objectStore(this.storeName).get(i);o.onerror=h=>t(o.error),o.onsuccess=()=>{e(o.result),l.close()}})}async setItem(i,l){const e=await this.getDb();if(typeof i=="number"&&(i=i.toString()),typeof i!="string")throw new Error("Key must be a string");return new Promise((t,n)=>{if(!this.storeName){n(new Error("Store name not set"));return}const r=e.transaction(this.storeName,"readwrite");r.onerror=f=>n(r.error);const h=r.objectStore(this.storeName).put(l,i);h.onerror=f=>n(h.error),h.onsuccess=()=>{e.close(),t()}})}async removeItem(i){const l=await this.getDb();if(typeof i=="number"&&(i=i.toString()),typeof i!="string")throw new Error("Key must be a string");return new Promise((e,t)=>{if(!this.storeName){t(new Error("Store name not set"));return}const n=l.transaction(this.storeName,"readwrite");n.onerror=h=>t(n.error);const o=n.objectStore(this.storeName).delete(i);o.onerror=h=>t(o.error),o.onsuccess=()=>{l.close(),e()}})}async keys(){const i=await this.getDb();return new Promise((l,e)=>{if(!this.storeName){e(new Error("Store name not set"));return}const t=i.transaction(this.storeName,"readonly");t.onerror=o=>e(t.error);const r=t.objectStore(this.storeName).getAllKeys();r.onerror=o=>e(r.error),r.onsuccess=()=>{l(r.result),i.close()}})}async count(){const i=await this.getDb();return new Promise((l,e)=>{if(!this.storeName){e(new Error("Store name not set"));return}const t=i.transaction(this.storeName,"readonly");t.onerror=o=>e(t.error);const r=t.objectStore(this.storeName).count();r.onerror=o=>e(r.error),r.onsuccess=()=>{l(r.result),i.close()}})}async length(){return this.count()}async clear(){const i=await this.getDb();return new Promise((l,e)=>{if(!this.storeName){e(new Error("Store name not set"));return}const t=i.transaction(this.storeName,"readwrite");t.onerror=o=>e(t.error);const r=t.objectStore(this.storeName).clear();r.onerror=o=>e(r.error),r.onsuccess=()=>{i.close(),l()}})}}return T.default=u,T}var ye;function Ee(){if(ye)return v;ye=1;var u=v&&v.__importDefault||function(d){return d&&d.__esModule?d:{default:d}};Object.defineProperty(v,"__esModule",{value:!0}),v.NearConnector=void 0;const c=ne(),i=Ie(),l=V(),e=u(_e()),t=Z(),n=fe(),r=we(),o=["https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/manifest.json","https://cdn.jsdelivr.net/gh/azbang/hot-connector/repository/manifest.json"];function h(d){return s=>Object.entries(d).length===0?!0:Object.entries(d).filter(([a,g])=>g===!0).every(([a])=>s.manifest.features?.[a]===!0)}let f=class{storage;events;db;logger;wallets=[];manifest={wallets:[],version:"1.0.0"};features={};network="mainnet";providers={mainnet:[],testnet:[]};walletConnect;footerBranding;excludedWallets=[];autoConnect;cspNonce;whenManifestLoaded;constructor(s){this.db=new e.default("hot-connector","wallets"),this.storage=s?.storage??new l.LocalStorage,this.events=s?.events??new c.EventEmitter,this.logger=s?.logger,this.cspNonce=s?.cspNonce,this.network=s?.network??"mainnet",this.walletConnect=s?.walletConnect,this.autoConnect=s?.autoConnect??!0,this.providers=s?.providers??{mainnet:[],testnet:[]},this.excludedWallets=s?.excludedWallets??[],this.features=s?.features??{},s?.footerBranding!==void 0?this.footerBranding=s?.footerBranding:this.footerBranding={icon:"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%20512%20512%22%20class%3D%22size-7%22%3E%3Crect%20width%3D%22512%22%20height%3D%22512%22%20fill%3D%22%2300ec97%22%20rx%3D%22110%22%2F%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M373.89%20106.199a31.95%2031.95%200%200%200-27.213%2015.207l-62.631%2092.979a6.67%206.67%200%200%200-.989%205.001%206.66%206.66%200%200%200%202.837%204.235%206.67%206.67%200%200%200%208.032-.494l61.643-53.47c1.02-.924%202.599-.827%203.523.193.419.473.644%201.074.644%201.697v167.402a2.49%202.49%200%200%201-2.502%202.491%202.48%202.48%200%200%201-1.912-.891L168.976%20117.497a31.93%2031.93%200%200%200-24.356-11.298h-6.508c-17.623%200-31.917%2014.294-31.917%2031.917v235.767c0%2017.623%2014.294%2031.917%2031.917%2031.917a31.94%2031.94%200%200%200%2027.213-15.206l62.631-92.98a6.66%206.66%200%200%200-1.847-9.236%206.67%206.67%200%200%200-8.033.494l-61.643%2053.471c-1.02.923-2.599.826-3.522-.194a2.5%202.5%200%200%201-.634-1.697V173.008a2.49%202.49%200%200%201%202.502-2.492c.731%200%201.439.322%201.912.891l186.313%20223.096a31.95%2031.95%200%200%200%2024.357%2011.297h6.508c17.623%200%2031.927-14.272%2031.938-31.895V138.116c0-17.623-14.294-31.917-31.917-31.917%22%2F%3E%3C%2Fsvg%3E",heading:"NEAR Connector",link:"https://wallet.near.org",linkText:"Don't have a wallet?"},this.whenManifestLoaded=new Promise(async a=>{s?.manifest==null||typeof s.manifest=="string"?this.manifest=await this._loadManifest(s?.manifest).catch(()=>({wallets:[],version:"1.0.0"})):this.manifest=s?.manifest??{wallets:[],version:"1.0.0"};const g=new Set(this.excludedWallets);g.delete("hot-wallet"),this.manifest.wallets=this.manifest.wallets.filter(w=>!(w.permissions.walletConnect&&!this.walletConnect||g.has(w.id))),await new Promise(w=>setTimeout(w,100)),a()}),typeof window<"u"&&(window.addEventListener("near-wallet-injected",this._handleNearWalletInjected),window.dispatchEvent(new Event("near-selector-ready")),window.addEventListener("message",async a=>{a.data.type==="near-wallet-injected"&&(await this.whenManifestLoaded.catch(()=>{}),this.wallets=this.wallets.filter(g=>g.manifest.id!==a.data.manifest.id),this.wallets.unshift(new t.ParentFrameWallet(this,a.data.manifest)),this.events.emit("selector:walletsChanged",{}),this.autoConnect&&this.connect({walletId:a.data.manifest.id}))})),this.whenManifestLoaded.then(()=>{typeof window<"u"&&window.parent.postMessage({type:"near-selector-ready"},"*"),this.manifest.wallets.forEach(a=>this.registerWallet(a)),this.storage.get("debug-wallets").then(a=>{JSON.parse(a??"[]").forEach(w=>this.registerDebugWallet(w))})})}get availableWallets(){return this.wallets.filter(a=>Object.entries(this.features).every(([g,w])=>!(w&&!a.manifest.features?.[g]))).filter(a=>!(this.network==="testnet"&&!a.manifest.features?.testnet))}_handleNearWalletInjected=s=>{this.wallets=this.wallets.filter(a=>a.manifest.id!==s.detail.manifest.id),this.wallets.unshift(new n.InjectedWallet(this,s.detail)),this.events.emit("selector:walletsChanged",{})};async _loadManifest(s){const a=s?[s]:o;for(const g of a){const w=await fetch(g).catch(()=>null);if(!(!w||!w.ok))return await w.json()}throw new Error("Failed to load manifest")}async switchNetwork(s,a){this.network!==s&&(await this.disconnect().catch(()=>{}),this.network=s,await this.connect(a))}async registerWallet(s){if(s.type!=="sandbox")throw new Error("Only sandbox wallets are supported");this.wallets.find(a=>a.manifest.id===s.id)||(this.wallets.push(new r.SandboxWallet(this,s)),this.events.emit("selector:walletsChanged",{}))}async registerDebugWallet(s){const a=typeof s=="string"?JSON.parse(s):s;if(a.type!=="sandbox")throw new Error("Only sandbox wallets type are supported");if(!a.id)throw new Error("Manifest must have an id");if(!a.name)throw new Error("Manifest must have a name");if(!a.icon)throw new Error("Manifest must have an icon");if(!a.website)throw new Error("Manifest must have a website");if(!a.version)throw new Error("Manifest must have a version");if(!a.executor)throw new Error("Manifest must have an executor");if(!a.features)throw new Error("Manifest must have features");if(!a.permissions)throw new Error("Manifest must have permissions");if(this.wallets.find(w=>w.manifest.id===a.id))throw new Error("Wallet already registered");a.debug=!0,this.wallets.unshift(new r.SandboxWallet(this,a)),this.events.emit("selector:walletsChanged",{});const g=this.wallets.filter(w=>w.manifest.debug).map(w=>w.manifest);return this.storage.set("debug-wallets",JSON.stringify(g)),a}async removeDebugWallet(s){this.wallets=this.wallets.filter(g=>g.manifest.id!==s);const a=this.wallets.filter(g=>g.manifest.debug).map(g=>g.manifest);this.storage.set("debug-wallets",JSON.stringify(a)),this.events.emit("selector:walletsChanged",{})}async selectWallet({features:s={}}={}){return await this.whenManifestLoaded.catch(()=>{}),new Promise((a,g)=>{const w=new i.NearWalletsPopup({footer:this.footerBranding,wallets:this.availableWallets.filter(h(s)).map(m=>m.manifest),onRemoveDebugManifest:async m=>this.removeDebugWallet(m),onAddDebugManifest:async m=>this.registerDebugWallet(m),onReject:()=>(g(new Error("User rejected")),w.destroy()),onSelect:m=>(a(m),w.destroy())});w.create()})}async connect(s={}){let a=s.walletId;const g=s.signMessageParams;await this.whenManifestLoaded.catch(()=>{}),a||(a=await this.selectWallet({features:{signInAndSignMessage:s.signMessageParams!=null?!0:void 0,signInWithFunctionCallKey:s.addFunctionCallKey!=null?!0:void 0}}));try{const w=await this.wallet(a);this.logger?.log("Wallet available to connect",w),await this.storage.set("selected-wallet",a),this.logger?.log(`Set preferred wallet, try to signIn${g!=null?" (with signed message)":""}`,a);let m;if(s.addFunctionCallKey!=null&&(this.logger?.log("Adding function call access key during sign in with params",s.addFunctionCallKey),m={...s.addFunctionCallKey,gasAllowance:s.addFunctionCallKey.gasAllowance??{amount:"250000000000000000000000",kind:"limited"}}),g!=null){const p=await w.signInAndSignMessage({addFunctionCallKey:m,messageParams:g,network:this.network});if(!p?.length)throw new Error("Failed to sign in");this.logger?.log("Signed in to wallet (with signed message)",a,p),this.events.emit("wallet:signInAndSignMessage",{wallet:w,accounts:p,success:!0}),this.events.emit("wallet:signIn",{wallet:w,accounts:p.map(C=>({accountId:C.accountId,publicKey:C.publicKey})),success:!0,source:"signInAndSignMessage"})}else{const p=await w.signIn({addFunctionCallKey:m,network:this.network});if(!p?.length)throw new Error("Failed to sign in");this.logger?.log("Signed in to wallet",a,p),this.events.emit("wallet:signIn",{wallet:w,accounts:p,success:!0,source:"signIn"})}return w}catch(w){throw this.logger?.log("Failed to connect to wallet",w),w}}async disconnect(s){s||(s=await this.wallet()),await s.signOut({network:this.network}),await this.storage.remove("selected-wallet"),this.events.emit("wallet:signOut",{success:!0})}async getConnectedWallet(){await this.whenManifestLoaded.catch(()=>{});const s=await this.storage.get("selected-wallet"),a=this.wallets.find(w=>w.manifest.id===s);if(!a)throw new Error("No wallet selected");const g=await a.getAccounts();if(!g?.length)throw new Error("No accounts found");return{wallet:a,accounts:g}}async wallet(s){if(await this.whenManifestLoaded.catch(()=>{}),!s)return this.getConnectedWallet().then(({wallet:g})=>g).catch(async()=>{throw await this.storage.remove("selected-wallet"),new Error("No accounts found")});const a=this.wallets.find(g=>g.manifest.id===s);if(!a)throw new Error("Wallet not found");return a}async use(s){await this.whenManifestLoaded.catch(()=>{}),this.wallets=this.wallets.map(a=>new Proxy(a,{get(g,w,m){const p=Reflect.get(g,w,m);if(w in s&&typeof p=="function"){const C=s[w];return function(...K){const z=()=>p.apply(g,K);return K.length>0?C.call(this,...K,z):C.call(this,void 0,z)}}return p}}))}on(s,a){this.events.on(s,a)}once(s,a){this.events.once(s,a)}off(s,a){this.events.off(s,a)}removeAllListeners(s){this.events.removeAllListeners(s)}};return v.NearConnector=f,v}var be;function We(){return be||(be=1,(function(u){Object.defineProperty(u,"__esModule",{value:!0}),u.nearActionsToConnectorActions=u.NearConnector=u.InjectedWallet=u.SandboxWallet=u.ParentFrameWallet=u.LocalStorage=void 0;var c=V();Object.defineProperty(u,"LocalStorage",{enumerable:!0,get:function(){return c.LocalStorage}});var i=Z();Object.defineProperty(u,"ParentFrameWallet",{enumerable:!0,get:function(){return i.ParentFrameWallet}});var l=we();Object.defineProperty(u,"SandboxWallet",{enumerable:!0,get:function(){return l.SandboxWallet}});var e=fe();Object.defineProperty(u,"InjectedWallet",{enumerable:!0,get:function(){return e.InjectedWallet}});var t=Ee();Object.defineProperty(u,"NearConnector",{enumerable:!0,get:function(){return t.NearConnector}});var n=F();Object.defineProperty(u,"nearActionsToConnectorActions",{enumerable:!0,get:function(){return n.nearActionsToConnectorActions}})})(R)),R}var b=We(),Me=b.InjectedWallet,$e=b.LocalStorage,Ne=b.NearConnector,je=b.ParentFrameWallet,qe=b.SandboxWallet,Oe=b.__esModule,Le=b.nearActionsToConnectorActions;export{Me as InjectedWallet,$e as LocalStorage,Ne as NearConnector,je as ParentFrameWallet,qe as SandboxWallet,Oe as __esModule,b as default,Le as nearActionsToConnectorActions};
//# sourceMappingURL=/sm/bf4698a2d8cb78dabdc6fb34bd8191c87cc4fb64933c8fa612b1b692b740356d.map