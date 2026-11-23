export namespace batch {
	
	export class Result {
	    sessionId: string;
	    sessionName: string;
	    success: boolean;
	    output: string;
	    error?: string;
	    duration: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.sessionName = source["sessionName"];
	        this.success = source["success"];
	        this.output = source["output"];
	        this.error = source["error"];
	        this.duration = source["duration"];
	    }
	}

}

export namespace sftpx {
	
	export class FileEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    mode: string;
	    modTime: string;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.modTime = source["modTime"];
	    }
	}
	export class TransferProgress {
	    id: string;
	    direction: string;
	    file: string;
	    bytes: number;
	    total: number;
	    percent: number;
	    status: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new TransferProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.direction = source["direction"];
	        this.file = source["file"];
	        this.bytes = source["bytes"];
	        this.total = source["total"];
	        this.percent = source["percent"];
	        this.status = source["status"];
	        this.message = source["message"];
	    }
	}

}

export namespace sshx {
	
	export class Manager {
	
	
	    static createFrom(source: any = {}) {
	        return new Manager(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}
	export class TestResult {
	    success: boolean;
	    message: string;
	    duration: number;
	    serverVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new TestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	        this.duration = source["duration"];
	        this.serverVersion = source["serverVersion"];
	    }
	}

}

export namespace store {
	
	export class Session {
	    id: string;
	    name: string;
	    group?: string;
	    host: string;
	    port: number;
	    username: string;
	    authType: string;
	    keyPath?: string;
	    encoding?: string;
	    color?: string;
	    favorite?: boolean;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.group = source["group"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authType = source["authType"];
	        this.keyPath = source["keyPath"];
	        this.encoding = source["encoding"];
	        this.color = source["color"];
	        this.favorite = source["favorite"];
	        this.createdAt = source["createdAt"];
	    }
	}

}

