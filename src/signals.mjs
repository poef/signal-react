const signalHandler = {
	get: (target, property, receiver) => {
		notifyGet(receiver, property)
		return target[property]
	},
	set: (target, property, value, receiver) => {
		if (target[property]!==value) {
			target[property] = value
			notifySet(receiver, property)
		}
		return true
	},
	has: (target, property, receiver) => {
		notifyGet(receiver, property)
		return Object.hasOwn(target, property)
	},
	deleteProperty: (target, property, receiver) => {
		if (typeof target[property] !== 'undefined') {
			delete target[property]		
			notifySet(receiver, property)
		}
	}
}

/**
 * Creates a new signal proxy of the given object, that intercepts get/has and set/delete
 * to allow reactive functions to be triggered when signal values change.
 */
export function signal(v) {
	return new Proxy(v, signalHandler)
}

/**
 * Called when a signal changes a property (set/delete)
 * Triggers any reactor function that depends on this signal
 * to re-compute its values
 */
function notifySet(self, property) {
	let listeners = getListeners(self, property)
	if (listeners) {
		for (let listener of Array.from(listeners)) {
			listener()
		}
	}
}

/**
 * Called when a signal property is accessed. If this happens
 * inside a reactor function--computeStack is not empty--
 * then it adds the current reactor (top of this stack) to its
 * listeners. These are later called if this property changes
 */
function notifyGet(self, property) {
	let currentCompute = computeStack[computeStack.length-1]
	if (currentCompute) {
		// get was part of a react() function, so add it
		setListeners(self, property, currentCompute)
	}
}

const listenersMap = new WeakMap()
const computeMap = new WeakMap()

function getListeners(self, property) {
	let listeners = listenersMap.get(self)
	return listeners?.[property]
}

function setListeners(self, property, compute) {
	if (!listenersMap.has(self)) {
		listenersMap.set(self, {})
	}
	let listeners = listenersMap.get(self)
	if (!listeners[property]) {
		listeners[property] = new Set()
	}
	listeners[property].add(compute)
	listenersMap.set(self, listeners)

	if (!computeMap.has(compute)) {
		computeMap.set(compute, {})
	}
	let connectedSignals = computeMap.get(compute)
	if (!connectedSignals[property]) {
		connectedSignals[property] = new Set
	}
	connectedSignals[property].add(self)
}

/**
 * Removes alle listeners that trigger the given reactor function (compute)
 * This happens when a reactor is called, so that it can set new listeners
 * based on the current call (code path)
 */
function clearListeners(compute) {
	let connectedSignals = computeMap.get(compute)
	if (connectedSignals) {
		Object.keys(connectedSignals).forEach(property => {
			connectedSignals[property].forEach(s => {
				let listeners = listenersMap.get(s)
				if (listeners?.[property]) {
					listeners[property].delete(compute)
				}
			})
		})
	}
}

const computeStack = []

const signals = new WeakMap()

const reactStack = []

/**
 * Runs the given function at once, and then whenever a signal changes that
 * is used by the given function (or at least signals used in the previous run).
 */
export function update(fn) {
	if (reactStack.findIndex(f => fn==f)!==-1) {
		throw new Error('Recursive react() call', {cause:fn})
	}
	reactStack.push(fn)

	let connectedSignal = signals.get(fn)
	if (!connectedSignal) {
		connectedSignal = signal({})
		signals.set(fn, connectedSignal)
	}
	const reactor = function reactor() {
		clearListeners(reactor)
		computeStack.push(reactor)
		let result = fn()
		computeStack.pop()
		Object.assign(connectedSignal, result)
	}
	reactor()
	return connectedSignal
}

/*
issues:
- signal(v) -> v must be an object
- fn() -> result must be an object
- no lazy evaluation yet
*/