'use strict';

const EventEmitter = require('events').EventEmitter;
const YeelightSearch = require('yeelight-wifi');

class Yeelight extends EventEmitter {

	constructor() {
		super();

		this._debug = true;
		this._devices = {};
		this.callDebounceTime = {};

		this.init = this._onExportsInit.bind(this);
		this.pair = this._onExportsPair.bind(this);
		this.added = this._onExportsAdded.bind(this);
		this.deleted = this._onExportsDeleted.bind(this);
		this.renamed = this._onExportsRenamed.bind(this);

		this.searchInstance = new YeelightSearch();
		this.searchInstance.on('found', console.log.bind(console, 'FOUND'));
		setInterval(() => this.searchInstance.client.search('wifi_bulb'), 10000);

		this.capabilities = {};

		this.capabilities.onoff = {};
		this.capabilities.onoff.get = this._onExportsCapabilitiesOnoffGet.bind(this);
		this.capabilities.onoff.set = this.delayCall.bind(this, this._onExportsCapabilitiesOnoffSet, 200);

		this.capabilities.dim = {};
		this.capabilities.dim.get = this._onExportsCapabilitiesDimGet.bind(this);
		this.capabilities.dim.set = this.delayCall.bind(this, this._onExportsCapabilitiesDimSet, 200);

		this.capabilities.light_hue = {};
		this.capabilities.light_hue.get = this._onExportsCapabilitiesLightHueGet.bind(this);
		this.capabilities.light_hue.set = this.delayCall.bind(this, this._onExportsCapabilitiesLightHueSet, 200);

		this.capabilities.light_saturation = {};
		this.capabilities.light_saturation.get = this._onExportsCapabilitiesLightSaturationGet.bind(this);
		this.capabilities.light_saturation.set = this.delayCall.bind(this, this._onExportsCapabilitiesLightSaturationSet, 200);

		this.capabilities.light_temperature = {};
		this.capabilities.light_temperature.get = this._onExportsCapabilitiesLightTemperatureGet.bind(this);
		this.capabilities.light_temperature.set = this.delayCall.bind(this, this._onExportsCapabilitiesLightTemperatureSet, 200);

		this.capabilities.light_mode = {};
		this.capabilities.light_mode.get = this._onExportsCapabilitiesLightModeGet.bind(this);
		this.capabilities.light_mode.set = this.delayCall.bind(this, this._onExportsCapabilitiesLightModeSet, 200);

		Homey
			.manager('flow')
			.on('action.startColorLoop', this._onFlowActionStartColorLoop.bind(this))
			.on('action.stopColorLoop', this._onFlowActionStopColorLoop.bind(this))

	}

	delayCall(func, delay, deviceData) {
		if (Date.now() - this.callDebounceTime[deviceData.id] < delay) {
			this.callDebounceTime[deviceData.id] += delay;
			console.log('delaying', Date.now() - this.callDebounceTime[deviceData.id]);
			setTimeout(() => func.apply(this, Array.from(arguments).slice(2)), this.callDebounceTime[deviceData.id] - Date.now());
		} else {
			console.log('executing now', Date.now(), this.callDebounceTime[deviceData.id], delay);
			this.callDebounceTime[deviceData.id] = Date.now();
			func.apply(this, Array.from(arguments).slice(2));
		}
	}

	getDeviceData(bridge, device) {
		return {
			id: device.uniqueId,
			bridge_id: bridge.id
		}
	}

	getDevice(deviceData) {
		return this._devices[deviceData.id] || new Error('invalid_device');
	}

	/*
	 Device methods
	 */
	_initDevice(deviceData) {
		this.debug('_initDevice', deviceData.id);

		const instance = this.searchInstance.getYeelightById(deviceData.id);
		if (instance) {
			this.setAvailable(deviceData);
			this._devices[deviceData.id] = {
				data: deviceData,
				state: {
					light_hue: 1,
					light_saturation: 1,
				},
				instance
			};

			instance.getValues().then((values) => {
				console.log('got values', values);
			});

			instance.on('notification', console.log.bind(console, 'notification'));

			// add state
			// capabilities.forEach((capability) => {
			// 	this._devices[deviceData.id].state[capability] = null;
			// });
		} else {
			setTimeout(() => {
				if (!this._devices[deviceData.id]) {
					this.setUnavailable(deviceData, __('unreachable'));
				}
			}, 1000);
			this.searchInstance.on('found', (instance) => {
				if (instance.id === deviceData.id) {
					this._initDevice(deviceData);
				}
			});
		}
	}

	_uninitDevice(deviceData) {
		this.debug('_uninitDevice', deviceData);

		delete this._devices[deviceData.id];
	}

	/*
	 Exports methods
	 */
	_onExportsInit(devices_data, callback) {
		this.debug('_onExportsInit', devices_data);

		devices_data.forEach(this._initDevice.bind(this));

		callback();

	}

	_onExportsAdded(deviceData) {
		this.debug('_onExportsAdded', deviceData);
		this._initDevice(deviceData);
	}

	_onExportsDeleted(deviceData) {
		this.debug('_onExportsDeleted', deviceData);
		this._uninitDevice(deviceData);
	}

	_onExportsPair(socket) {
		this.debug('_onExportsPair');

		const instanceToDeviceData = (instance) =>
			Promise.all([instance.getName(), instance.getId()])
				.then((result) => ({
					name: result[0] || 'Yeelight',
					data: {
						id: result[1],
					},
				}));

		socket
			.on('list_devices', (data, callback) => {
				Promise.all(this.searchInstance.getYeelights().map(instanceToDeviceData))
					.then((result) => {
						callback(null, result);
					});
			})
			.on('disconnect', () => {

			})

	}

	_onExportsRenamed(deviceData, newName) {
		this.debug('_onExportsRenamed', deviceData.id, newName);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return this.error(device);

		device.instance.setName(newName);
	}

	_onExportsCapabilitiesOnoffGet(deviceData, callback) {
		this.debug('_onExportsCapabilitiesOnoffGet', deviceData.id);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.onoff);
	}

	// onoff
	_onExportsCapabilitiesOnoffSet(deviceData, value, callback) {
		this.debug('_onExportsCapabilitiesOnoffSet', deviceData.id, value);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.state.onoff = value;

		device.instance[value ? 'turnOn' : 'turnOff']()
			.then(callback.bind(null, null, value))
			.catch(callback);
	}

	// dim
	_onExportsCapabilitiesDimGet(deviceData, callback) {
		this.debug('_onExportsCapabilitiesDimGet', deviceData.id);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.dim);
	}

	_onExportsCapabilitiesDimSet(deviceData, value, callback) {
		this.debug('_onExportsCapabilitiesDimSet', deviceData.id, value);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.state.dim = value;
		device.state.onoff = ( value > 0 );
		module.exports.realtime(deviceData, 'onoff', device.state.onoff);

		device.instance.setBrightness(Math.round(value * 100))
			.then(callback.bind(null, null, value))
			.catch(callback);
	}

	// light_hue
	_onExportsCapabilitiesLightHueGet(deviceData, callback) {
		this.debug('_onExportsCapabilitiesLightHueGet', deviceData.id);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.light_hue);
	}

	_onExportsCapabilitiesLightHueSet(deviceData, value, callback) {
		this.debug('_onExportsCapabilitiesLightHueSet', deviceData.id, value);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.state.light_hue = value;

		if (typeof device.state.light_mode !== 'undefined') {
			device.state.light_mode = 'color';
			module.exports.realtime(deviceData, 'light_mode', device.state.light_mode);
		}

		if (!device.state.onoff) {
			this._onExportsCapabilitiesOnoffSet(deviceData, true, (err) => {
				if (err) return callback(err);
				module.exports.realtime(deviceData, 'onoff', true);
				setTimeout(
					() =>
						device.instance.setHSV(Math.round(value * 359), Math.round(device.state.light_saturation * 100))
							.then(callback.bind(null, null, value))
							.catch(callback),
					150
				);
			});
		} else {
			device.instance.setHSV(Math.round(value * 359), Math.round(device.state.light_saturation * 100))
				.then(callback.bind(null, null, value))
				.catch(callback);
		}
	}

	// light_saturation
	_onExportsCapabilitiesLightSaturationGet(deviceData, callback) {
		this.debug('_onExportsCapabilitiesLightSaturationGet', deviceData.id);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.light_saturation);
	}

	_onExportsCapabilitiesLightSaturationSet(deviceData, value, callback) {
		this.debug('_onExportsCapabilitiesLightSaturationSet', deviceData.id, value);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.state.light_saturation = value;

		if (typeof device.state.light_mode !== 'undefined') {
			device.state.light_mode = 'color';
			module.exports.realtime(deviceData, 'light_mode', device.state.light_mode);
		}

		if (!device.state.onoff) {
			this._onExportsCapabilitiesOnoffSet(deviceData, true, (err) => {
				if (err) return callback(err);
				module.exports.realtime(deviceData, 'onoff', true);
				setTimeout(
					() =>
				device.instance.setHSV(Math.round(device.state.light_hue * 359), Math.round(value * 100))
					.then(callback.bind(null, null, value))
					.catch(callback),
					150
				);
			});
		} else {
			device.instance.setHSV(Math.round(device.state.light_hue * 359), Math.round(value * 100))
				.then(callback.bind(null, null, value))
				.catch(callback);
		}
	}

	// light_temperature
	_onExportsCapabilitiesLightTemperatureGet(deviceData, callback) {
		this.debug('_onExportsCapabilitiesLightTemperatureGet', deviceData.id);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.light_temperature);
	}

	_onExportsCapabilitiesLightTemperatureSet(deviceData, value, callback) {
		this.debug('_onExportsCapabilitiesLightTemperatureSet', deviceData.id, value);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.state.light_temperature = value;

		if (typeof device.state.light_mode !== 'undefined') {
			device.state.light_mode = 'temperature';
			module.exports.realtime(deviceData, 'light_mode', device.state.light_mode);
		}

		if (!device.state.onoff) {
			this._onExportsCapabilitiesOnoffSet(deviceData, true, (err) => {
				if (err) return callback(err);
				module.exports.realtime(deviceData, 'onoff', true);
				setTimeout(
					() =>
				device.instance.setColorTemperature(Math.round(6500 - device.state.light_temperature * (6500 - 1700)))
					.then(callback.bind(null, null, value))
					.catch(callback),
					150
				);

			});
		} else {
			device.instance.setColorTemperature(Math.round(6500 - device.state.light_temperature * (6500 - 1700)))
				.then(callback.bind(null, null, value))
				.catch(callback);
		}
	}

	// light_mode
	_onExportsCapabilitiesLightModeGet(deviceData, callback) {
		this.debug('_onExportsCapabilitiesLightModeGet', deviceData.id);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.light_mode);
	}

	_onExportsCapabilitiesLightModeSet(deviceData, value, callback) {
		this.debug('_onExportsCapabilitiesLightModeSet', deviceData.id, value);

		let device = this.getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.state.light_mode = value;

		if (value === 'temperature') {
			this._onExportsCapabilitiesLightTemperatureSet(deviceData, device.state.light_temperature, callback);
		} else if ('color') {
			this._onExportsCapabilitiesLightHueSet(deviceData, device.state.light_hue, callback);
		}
	}

	/*
	 Flow methods
	 */

	_onFlowActionStartColorLoop(callback, args, state) {

		let device = this.getDevice(args.device);
		if (device instanceof Error) return callback(device);

		device.setInstanceProperty('alert', 'none');
		device.setInstanceProperty('effect', 'colorloop');
		device.save(callback);

	}

	_onFlowActionStopColorLoop(callback, args, state) {

		let device = this.getDevice(args.device);
		if (device instanceof Error) return callback(device);

		device.setInstanceProperty('alert', 'none');
		device.setInstanceProperty('effect', 'none');
		device.save(callback);

	}

	/*
	 Helper methods
	 */
	debug() {
		if (this._debug) {
			this.log.apply(this, arguments);
		}
	}

	log() {
		if (Homey.app) {
			Homey.log.bind(Homey.app, `[${this.constructor.name}]`).apply(Homey.app, arguments);
		}
	}

	error() {
		if (Homey.app) {
			Homey.error.bind(Homey.app, `[${this.constructor.name}]`).apply(Homey.app, arguments);
		}
	}
}

module.exports = new Yeelight();