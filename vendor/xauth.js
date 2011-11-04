var XAuth = (function () {
    var j = window;
    var q = !(j.postMessage && j.localStorage && j.JSON);
    var n = "static.localhost.gz" ;
    var e = "http://" + n + ":8080/files/xAuthServer.htm";
    var g = null;
    var a = null;
    var p = {};
    var d = 0;
    var m = [];

    function o(s) {
        var u = s.origin.split("://")[1].split(":")[0];
        if (u != n) {
            return
        }
        var t = JSON.parse(s.data);
        if (!t) {
            return
        }
        if (t.cmd == "xauth::ready") {
            a = g.contentWindow;
            setTimeout(f, 0);
            return
        }
        var r = p[t.id];
        if (r) {
            if (r.callback) {
                r.callback(t)
            }
            delete p[t.id]
        }
    }
    function i() {
        if (g || a) {
            return
        }
        var s = j.document;
        g = s.createElement("iframe");
        var r = g.style;
        r.position = "absolute";
        r.left = r.top = "-999px";
        if (j.addEventListener) {
            j.addEventListener("message", o, false)
        } else {
            if (j.attachEvent) {
                j.attachEvent("onmessage", o)
            }
        }
        s.body.appendChild(g);
        g.src = e
    }
    function f() {
        for (var r = 0; r < m.length; r++) {
            c(p[m.shift()])
        }
    }
    function c(r) {
        a.postMessage(JSON.stringify(r), e)
    }
    function h(r) {
        if (q) {
            return
        }
        r.id = d;
        p[d++] = r;
        if (!g || !a) {
            m.push(r.id);
            i()
        } else {
            c(r)
        }
    }
    function l(r) {
        if (!r) {
            r = {}
        }
        var s = {
            cmd: "xauth::retrieve",
            retrieve: r.retrieve || [],
            callback: r.callback || null
        };
        h(s)
    }
    function k(r) {
        if (!r) {
            r = {}
        }
        var s = {
            cmd: "xauth::extend",
            data: r.data|| "",
	    key: r.key || "",
            expire: r.expire || 0,
            extend: r.extend || [],
            session: r.session || false,
            callback: r.callback || null
        };
        h(s)
    }
    function b(r) {
        if (!r) {
            r = {}
        }
        var s = {
            cmd: "xauth::expire",
            callback: r.callback || null
        };
        h(s)
    }
    return {
        extend: k,
        retrieve: l,
        expire: b,
        disabled: q
    }
})();
