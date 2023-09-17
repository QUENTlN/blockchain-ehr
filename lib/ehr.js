'use strict';

import { crypto } from 'crypto';
const { Contract } = require('fabric-contract-api');

class EhrContract extends Contract {

    async registerUser(ctx, userPublicKey) {
        await ctx.stub.putState(ctx.clientIdentity.getID(), Buffer.from(userPublicKey));
    }

    async registerHealthOrganizationNeededData(ctx, data) {
        data.typeInfo = 'healthOrganizationNeededData';
        data.healthOrganizationId = ctx.clientIdentity.getID();
        await ctx.stub.putState(ctx.clientIdentity.getID()+"data", Buffer.from(JSON.stringify(data)));
    }

    async addEHR(ctx, data) {
        const ehrId = "ehr_" + ctx.stub.getTxID();

        const publicKey = await ctx.stub.getState(data.patientId);

        const encodedPatientAccessKey = crypto.publicEncrypt(publicKey.toString('utf8'), Buffer.from(data.documentKey));

        let doctorArray = {};

        if (data.patientId !== ctx.clientIdentity.getID()) {
            const doctorId = ctx.clientIdentity.getID();

            const doctorPublicKey = await ctx.stub.getState(ctx.clientIdentity.getID());

            const encodedDoctorAccessKey = crypto.publicEncrypt(doctorPublicKey.toString('utf8'), Buffer.from(data.documentKey));

            doctorArray[doctorId] = {
                key: encodedDoctorAccessKey,
                reasonToAccess: ['dataAdding']
            };
        }

        // request all the health organizations
		let queryString = {};
		queryString.selector = {};
		queryString.selector.typeInfo = 'healthOrganiationNeededData';

        let iterator = ctx.stub.getQueryResult(JSON.stringify(queryString));
        let allHealthOrgs = [];
		let res = await iterator.next();
		while (!res.done) {
			if (res.value && res.value.value.toString()) {
				let jsonRes = {};
				jsonRes.Key = res.value.key;
				try {
					jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
				} catch (err) {
					jsonRes.Record = res.value.value.toString('utf8');
				}
				allHealthOrgs.push(jsonRes);
			}
			res = await iterator.next();
		}
		iterator.close();

        let healthOragnizations = {};
        allHealthOrgs.forEach(org => {
            org.rules.forEach( async rule => {
                if (data.typeEHR === rule.typeEHR) {
                    const now = new Date();
                    const duration = rule.duration;
                    const expiryDate = new Date(now.getTime() + duration * 60000);

                    const organizationPublicKey = await ctx.stub.getState(org.healthOrganizationId);

                    const encodedOrgAccessKey = crypto.publicEncrypt(organizationPublicKey.toString('utf8'), Buffer.from(data.documentKey));

                    healthOragnizations[org.healthOrganizationId] = {
                        key: encodedOrgAccessKey,
                        expiryDate: expiryDate,
                    };
                }
            });
        });

        const ehr = {
            documentId: ehrId,
            typeInfo: 'healthRecord',
            status: 'initialised',
            typeEHR: data.typeEHR,
            patientId: data.patientId,
            patientAccessKey: encodedPatientAccessKey,
            dataAdderId: ctx.clientIdentity.getID(),
            doctor: doctorArray,
            healthOragnizations: healthOragnizations,
            hash: data.hash,
        };
        await ctx.stub.putState(ehrId, Buffer.from(JSON.stringify(ehr)));
        return ehrId;
    }

    async checkHash(ctx, data) {
        const ehrAsBytes = await ctx.stub.getState(data.documentId);
        if (!ehr || ehr.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        if (ehr.hash !== data.hash) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (ou == 'gateway') {
            const patientPublicKey = await ctx.stub.getState(ehr.patientId);
            const dataAdderPublicKey = await ctx.stub.getState(ehr.dataAdderId);
            if (!patientPublicKey || patientPublicKey.length === 0 || !dataAdderPublicKey || dataAdderPublicKey.length === 0) {
                throw new Error(`You are not authorized to do this action`);
            }
            return JSON.stringify({
                patientPublicKey: await ctx.stub.getState(ehr.patientId),
                dataAdderPublicKey: await ctx.stub.getState(ehr.dataAdderId),
            });
        }
        return true;
    }

    async addToken(ctx, documentId, editToken, deleteToken) {
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (ou.includes('gateway')) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehrAsBytes = await ctx.stub.getState(data.documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        const editorPublicKey = await ctx.stub.getState(ehr.dataAdderId);
        ehr.editToken = crypto.publicEncrypt(editorPublicKey.toString('utf8'), Buffer.from(editToken));
        const deletorPublicKey = await ctx.stub.getState(ehr.patientId);
        ehr.deleteToken = crypto.publicEncrypt(deletorPublicKey.toString('utf8'), Buffer.from(deleteToken));
        ehr.status = 'available';
        await ctx.stub.putState(documentId, Buffer.from(JSON.stringify(ehr)));
    }

    async editEHR(ctx, documentId, typeEHR, documentHash) {
        const ehrAsBytes = await ctx.stub.getState(documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        if (ehr.status !== 'available') {
            throw new Error(`You are not authorized to do this action`);
        }
        if (ehr.dataAdderId !== ctx.clientIdentity.getID()) {
            throw new Error(`You are not authorized to do this action`);
        }
        ehr.status = 'inEditing';
        
        // request all the health organizations
		let queryString = {};
		queryString.selector = {};
		queryString.selector.typeInfo = 'healthOrganiationNeededData';

        let iterator = ctx.stub.getQueryResult(JSON.stringify(queryString));
        let allHealthOrgs = [];
		let res = await iterator.next();
		while (!res.done) {
			if (res.value && res.value.value.toString()) {
				let jsonRes = {};
				jsonRes.Key = res.value.key;
				try {
					jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
				} catch (err) {
					jsonRes.Record = res.value.value.toString('utf8');
				}
				allHealthOrgs.push(jsonRes);
			}
			res = await iterator.next();
		}
		iterator.close();

        let healthOragnizations = {};
        allHealthOrgs.forEach(org => {
            org.rules.forEach( async rule => {
                if (typeEHR === rule.typeEHR) {
                    const now = new Date();
                    const duration = rule.duration;
                    const expiryDate = new Date(now.getTime() + duration * 60000);

                    const organizationPublicKey = await ctx.stub.getState(org.healthOrganizationId);

                    const encodedOrgAccessKey = crypto.publicEncrypt(organizationPublicKey.toString('utf8'), Buffer.from(data.documentKey));

                    healthOragnizations[org.healthOrganizationId] = {
                        key: encodedOrgAccessKey,
                        expiryDate: expiryDate,
                    };
                }
            });
        });

        ehr.healthOragnizations = healthOragnizations
        ehr.hash = documentHash;

        await ctx.stub.putState(documentId, Buffer.from(JSON.stringify(ehr)));

        return ehr.editToken;
    }

    async updateEditingToken(ctx, documentId, editToken) {
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (ou.includes('gateway')) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehrAsBytes = await ctx.stub.getState(documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        if (ehr.status !== 'inEditing') {
            throw new Error(`You are not authorized to do this action`);
        }
        ehr.status = 'available';
        const editorPublicKey = await ctx.stub.getState(ehr.dataAdderId);
        ehr.editToken = crypto.publicEncrypt(editorPublicKey.toString('utf8'), Buffer.from(editToken));
        await ctx.stub.putState(documentId, Buffer.from(JSON.stringify(ehr)));
    }

    async deleteEHR(ctx, documentId) {
        const ehrAsBytes = await ctx.stub.getState(documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        if (ehr.patientId !== ctx.clientIdentity.getID()) {
            throw new Error(`You are not authorized to do this action`);
        }
        for (const [key, value] of Object.entries(ehr.healthOragnizations)) {
            if (value.expiryDate < new Date()) {
                throw new Error(`You are not authorized to do this action`);
            }
        }
        const deleteToken = ehr.deleteToken;
        await ctx.stub.deleteState(documentId);
        return deleteToken;
    }

    async getAccessKey(ctx, documentId) {
        const ehrAsBytes = await ctx.stub.getState(documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        if (ehr.patientId == ctx.clientIdentity.getID()) {
            return ehr.patientAccessKey;
        }
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (ou.includes('doctor')) {
            if (!ehr.doctor[ctx.clientIdentity.getID()]) {
                throw new Error(`You are not authorized to do this action`);
            }
            return ehr.doctor[ctx.clientIdentity.getID()].key;
        }
        if (ou.includes('healthOrganization')) {
            if (!ehr.healthOragnizations[ctx.clientIdentity.getID()]) {
                throw new Error(`You are not authorized to do this action`);
            }
            if (ehr.healthOragnizations[ctx.clientIdentity.getID()].expiryDate < new Date()) {
                throw new Error(`You are not authorized to do this action`);
            }
            return ehr.healthOragnizations[ctx.clientIdentity.getID()].key;
        }
        throw new Error(`You are not authorized to do this action`);
    }

    async requestAccess(ctx, patientId, requestedData) {
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (!ou.includes('doctor')) {
            throw new Error(`You are not authorized to do this action`);
        }
        const requestToSave = {
            typeInfo: 'dataRequest',
            patientId: patientId,
            doctorId: ctx.clientIdentity.getID(),
            request: requestedData,
        };
        await ctx.stub.putState(ctx.stub.getTxID(), Buffer.from(JSON.stringify(requestToSave)));
    }

    async getRequests(ctx) {
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (!ou.includes('patient')) {
            throw new Error(`You are not authorized to do this action`);
        }
        let queryString = {};
        queryString.selector = {};
        queryString.selector.typeInfo = 'dataRequest';
        queryString.selector.patientId = ctx.clientIdentity.getID();

        let iterator = ctx.stub.getQueryResult(JSON.stringify(queryString));
        let allRequest = [];
		let res = await iterator.next();
		while (!res.done) {
			if (res.value && res.value.value.toString()) {
				let jsonRes = {};
				jsonRes.Key = res.value.key;
				try {
					jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
				} catch (err) {
					jsonRes.Record = res.value.value.toString('utf8');
				}
				allRequest.push(jsonRes);
			}
			res = await iterator.next();
		}
		iterator.close();

        return JSON.stringify(allRequest);
    }

    async grantAccess(ctx, documentId, doctorId, reasonToAccess, doctorAccessKey) {
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (!ou.includes('patient')) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehrAsBytes = await ctx.stub.getState(documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        if (ehr.patientId !== ctx.clientIdentity.getID()) {
            throw new Error(`You are not authorized to do this action`);
        }
        ehr.doctor[doctorId] = {
            key: doctorAccessKey,
            reasonToAccess: reasonToAccess,
        };
        await ctx.stub.putState(documentId, Buffer.from(JSON.stringify(ehr)));
    }

    async revokeAccess(ctx, documentId, doctorId, reasonToAccess) {
        const clientIdentity = new ClientIdentity(ctx.stub);
        const ou = clientIdentity.getAttributeValue('ou');
        if (!ou.includes('patient')) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehrAsBytes = await ctx.stub.getState(documentId);
        if (!ehrAsBytes || ehrAsBytes.length === 0) {
            throw new Error(`You are not authorized to do this action`);
        }
        const ehr = JSON.parse(ehrAsBytes.toString());
        if (ehr.patientId !== ctx.clientIdentity.getID()) {
            throw new Error(`You are not authorized to do this action`);
        }
        ehr.doctor[doctorId].reasonToAccess = ehr.doctor[doctorId].reasonToAccess.filter(reason => !reasonToAccess.includes(reason));
        if (ehr.doctor[doctorId].reasonToAccess.length === 0) {
            delete ehr.doctor[doctorId];
        }
        await ctx.stub.putState(documentId, Buffer.from(JSON.stringify(ehr)));
    }
}

module.exports = EhrContract;