export function test1(emptyObject: {}, objectKeyword: object, record: Record<string, any>) {}

export function test2(
	emptyInterface: EmptyInterface,
	emptyObject: EmptyObject,
	objectKeyword: ObjectKeyword,
	recordType: RecordType,
) {}

export function test3(params: Params) {}

interface Params {
	emptyInterface: EmptyInterface;
	emptyObject: EmptyObject;
	inlineEmptyObject: {};
	objectKeyword: ObjectKeyword;
	inlineObjectKeyword: object;
	recordType: RecordType;
	inlineRecordType: Record<string, any>;
}

type EmptyObject = {};

interface EmptyInterface {}

type ObjectKeyword = object;

type RecordType = Record<string, any>;
